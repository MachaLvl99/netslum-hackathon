import { Agent } from "@atproto/api";
import { NetslumError, prepareImageSchema, prepareVideoSchema } from "@netslum/contracts";
import { z } from "zod";
import type { CloudflareEnv } from "../../types.js";
import { getOAuthClient } from "../auth/oauth.js";
import { encryptJson, decryptJson } from "../auth/crypto.js";
import { VIDEO_SERVICE_AUDIENCE } from "../auth/permissions.js";

const IMAGE_LIMIT_BYTES = 1_000_000;
export const VIDEO_LIMIT_BYTES = 100_000_000;
export const VIDEO_CHUNK_BYTES = 5_242_880; // 5 MiB — matches the live video service part size.
const MEDIA_DRAFT_TTL_MS = 10 * 60_000; // 10 minutes (Phase 2 plan §G)
const VIDEO_SERVICE_ENDPOINT = "https://video.bsky.app";

interface MediaDraftRow {
  payload_enc: ArrayBuffer | null;
  blob_enc: ArrayBuffer | null;
  kind: string;
}

export interface PreparedImagePayload {
  kind: "image";
  mimeType: string;
  sizeBytes: number;
  byteLength?: number | undefined;
  alt: string;
  confirmNoAlt?: boolean | undefined;
  createdAt: number;
}

export interface PreparedVideoPayload {
  kind: "video";
  mimeType: string;
  sizeBytes: number;
  byteLength?: number | undefined;
  name?: string | undefined;
  alt?: string | undefined;
  jobId?: string | undefined;
  createdAt: number;
}

export interface MediaBlobRefResult {
  kind: "image" | "video";
  blob: Record<string, unknown>;
  image?: Record<string, unknown> | undefined;
  video?: Record<string, unknown> | undefined;
  alt: string;
}

export interface VideoJobStatusResult {
  jobId: string;
  did?: string | undefined;
  state: string;
  progress?: number | undefined;
  blob?: Record<string, unknown> | undefined;
  blobRef?: Record<string, unknown> | undefined;
  error?: string | undefined;
  message?: string | undefined;
}

const serviceAuthResponseSchema = z.object({
  token: z.string()
});

const videoJobStatusResponseSchema = z.object({
  jobStatus: z.object({
    jobId: z.string(),
    did: z.string().optional(),
    state: z.string(),
    progress: z.number().optional(),
    blob: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
    message: z.string().optional()
  })
});

const storedBlobRecordSchema = z.object({
  blob: z.record(z.string(), z.unknown()).optional(),
  image: z.record(z.string(), z.unknown()).optional(),
  video: z.record(z.string(), z.unknown()).optional(),
  alt: z.string().optional()
});

const storedMetadataSchema = z.object({
  alt: z.string().optional(),
  kind: z.enum(["image", "video"]).optional(),
  jobId: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  name: z.string().optional()
});

/**
 * Phase 2 (plan §C4): image and video upload pipeline.
 *
 * Images: the browser posts the bytes to Netslum; the Worker streams them to
 * the actor's PDS uploadBlob with the user's OAuth session — tokens never
 * reach browser JavaScript. Draft metadata is encrypted at rest (§G) with the
 * independent PRIVATE_DATA_KEY and expires.
 *
 * Videos: the browser posts metadata to prepare; the Worker authorizes the
 * video upload via service-auth or direct video RPCs, accepts chunks or whole
 * uploads, tracks processing status via app.bsky.video.getJobStatus, and
 * attaches the completed blob reference for post publishing.
 */
export class MediaService {
  constructor(private readonly env: CloudflareEnv) {}

  private key(): string {
    if (!this.env.PRIVATE_DATA_KEY) throw new NetslumError("WORKER_FAILED", "Private data key is not configured", 500);
    return this.env.PRIVATE_DATA_KEY;
  }

  async agentFor(actorDid: string): Promise<Agent> {
    const client = await getOAuthClient(this.env);
    const session = await client.restore(actorDid).catch(() => undefined);
    if (!session) throw new NetslumError("AUTH_REQUIRED", "Please sign in again", 401);
    return new Agent(session);
  }

  private async insertDraft(actorDid: string, kind: "image" | "video", payload: unknown): Promise<string> {
    const draftId = crypto.randomUUID();
    const payloadEnc = await encryptJson(payload, this.key());
    await this.env.DB.prepare(
      "INSERT INTO media_draft(draft_id,did,kind,payload_enc,created_at,expires_at) VALUES(?,?,?,?,?,?)"
    ).bind(draftId, actorDid, kind, payloadEnc, Date.now(), Date.now() + MEDIA_DRAFT_TTL_MS).run();
    return draftId;
  }

  async prepareImage(
    actorDid: string,
    input: (z.infer<typeof prepareImageSchema> & { byteLength?: number | undefined }) | { mimeType: string; byteLength?: number | undefined; sizeBytes?: number | undefined; alt?: string | undefined; confirmNoAlt?: boolean | undefined }
  ): Promise<{ draftId: string }> {
    const sizeBytes = input.sizeBytes ?? input.byteLength;
    if (typeof sizeBytes !== "number" || sizeBytes <= 0 || sizeBytes > IMAGE_LIMIT_BYTES) {
      throw new NetslumError("INVALID_INPUT", `Image size must be between 1 and ${IMAGE_LIMIT_BYTES} bytes`, 400);
    }
    const alt = input.alt ?? "";
    const confirmNoAlt = input.confirmNoAlt ?? (alt.length === 0);
    const validated = prepareImageSchema.parse({
      mimeType: input.mimeType,
      alt,
      sizeBytes,
      confirmNoAlt
    });

    const payload: PreparedImagePayload = {
      kind: "image",
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      byteLength: validated.sizeBytes,
      alt: validated.alt,
      confirmNoAlt: validated.confirmNoAlt ?? false,
      createdAt: Date.now()
    };
    return { draftId: await this.insertDraft(actorDid, "image", payload) };
  }

  async prepareVideo(
    actorDid: string,
    input: (z.infer<typeof prepareVideoSchema> & { byteLength?: number | undefined; name?: string | undefined }) | { mimeType: string; byteLength?: number | undefined; sizeBytes?: number | undefined; name?: string | undefined; alt?: string | undefined }
  ): Promise<{ draftId: string }> {
    const sizeBytes = input.sizeBytes ?? input.byteLength;
    if (typeof sizeBytes !== "number" || sizeBytes <= 0 || sizeBytes > VIDEO_LIMIT_BYTES) {
      throw new NetslumError("INVALID_INPUT", `Video size must be between 1 and ${VIDEO_LIMIT_BYTES} bytes`, 400);
    }
    const validated = prepareVideoSchema.parse({
      mimeType: input.mimeType,
      sizeBytes,
      ...(input.alt !== undefined ? { alt: input.alt } : {})
    });

    const payload: PreparedVideoPayload = {
      kind: "video",
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      byteLength: validated.sizeBytes,
      name: input.name ?? "video.mp4",
      alt: validated.alt ?? "",
      createdAt: Date.now()
    };
    return { draftId: await this.insertDraft(actorDid, "video", payload) };
  }

  private async loadDraft(actorDid: string, draftId: string): Promise<MediaDraftRow> {
    const row = await this.env.DB.prepare(
      "SELECT payload_enc, blob_enc, kind FROM media_draft WHERE draft_id=? AND did=? AND expires_at > ?"
    ).bind(draftId, actorDid, Date.now()).first<MediaDraftRow>();
    if (!row) throw new NetslumError("NOT_FOUND", "Media draft expired or missing", 404);
    return row;
  }

  async uploadImage(actorDid: string, draftId: string, data: Uint8Array | ArrayBuffer): Promise<{ blobRef: Record<string, unknown> }> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const row = await this.loadDraft(actorDid, draftId);
    if (!row.payload_enc) throw new NetslumError("NOT_FOUND", "Media draft has no metadata", 404);
    const meta = await decryptJson<PreparedImagePayload>(row.payload_enc, this.key());
    if (bytes.byteLength > IMAGE_LIMIT_BYTES) {
      throw new NetslumError("INVALID_INPUT", `Image exceeds maximum allowed size of ${IMAGE_LIMIT_BYTES} bytes`, 400);
    }
    if (meta.sizeBytes && bytes.byteLength !== meta.sizeBytes) {
      throw new NetslumError("INVALID_INPUT", "Image bytes do not match the prepared draft size", 400);
    }
    const agent = await this.agentFor(actorDid);
    const response = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: meta.mimeType }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new NetslumError("UPSTREAM_UNAVAILABLE", `Image upload failed: ${message.slice(0, 160)}`, 502, true);
    });
    const blobRef = response.data.blob as unknown as Record<string, unknown>;
    const blobPayload = {
      blob: blobRef,
      alt: meta.alt ?? "",
      kind: "image",
      uploadedAt: Date.now()
    };
    const blobEnc = await encryptJson(blobPayload, this.key());
    await this.env.DB.prepare("UPDATE media_draft SET blob_enc=? WHERE draft_id=? AND did=?").bind(blobEnc, draftId, actorDid).run();
    return { blobRef };
  }

  async getJobStatus(actorDid: string, jobId: string): Promise<VideoJobStatusResult> {
    const agent = await this.agentFor(actorDid);

    try {
      const authRes = await agent.com.atproto.server.getServiceAuth({
        aud: VIDEO_SERVICE_AUDIENCE,
        lxm: "app.bsky.video.getJobStatus"
      }).catch(() => null);

      const parsedAuth = authRes?.data ? serviceAuthResponseSchema.safeParse(authRes.data).data : undefined;
      const url = `${VIDEO_SERVICE_ENDPOINT}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`;
      const headers: Record<string, string> = {};
      if (parsedAuth?.token) {
        headers["Authorization"] = `Bearer ${parsedAuth.token}`;
      }
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (res && res.ok) {
        const json: unknown = await res.json().catch(() => null);
        const parsed = videoJobStatusResponseSchema.safeParse(json);
        if (parsed.success) {
          const js = parsed.data.jobStatus;
          return {
            jobId: js.jobId,
            did: js.did,
            state: js.state,
            progress: js.progress,
            blob: js.blob,
            blobRef: js.blob,
            error: js.error,
            message: js.message
          };
        }
      }
    } catch { /* fallback to agent method */ }

    try {
      const response = await agent.app.bsky.video.getJobStatus({ jobId }, { signal: AbortSignal.timeout(8000) });
      const js = response.data.jobStatus;
      return {
        jobId: js.jobId,
        did: js.did,
        state: js.state,
        progress: js.progress,
        blob: js.blob as unknown as Record<string, unknown> | undefined,
        blobRef: js.blob as unknown as Record<string, unknown> | undefined,
        error: js.error,
        message: js.message
      };
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 0;
      if (status === 404) throw new NetslumError("NOT_FOUND", "Video job not found", 404);
      const message = error instanceof Error ? error.message : "Invalid job status request";
      if (status === 400) throw new NetslumError("INVALID_INPUT", message.slice(0, 160), 400);
      throw new NetslumError("VIDEO_UNAVAILABLE", "Video service unavailable", 503, true);
    }
  }

  async uploadVideo(actorDid: string, draftId: string, data: Uint8Array | ArrayBuffer): Promise<{ draftId: string; jobId?: string | undefined; blobRef?: Record<string, unknown> | undefined; status: string }> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const row = await this.loadDraft(actorDid, draftId);
    if (!row.payload_enc) throw new NetslumError("NOT_FOUND", "Media draft has no metadata", 404);
    const meta = await decryptJson<PreparedVideoPayload>(row.payload_enc, this.key());
    if (bytes.byteLength > VIDEO_LIMIT_BYTES) {
      throw new NetslumError("INVALID_INPUT", `Video exceeds maximum allowed size of ${VIDEO_LIMIT_BYTES} bytes`, 400);
    }
    const agent = await this.agentFor(actorDid);

    let blobRef: Record<string, unknown> | undefined;
    let jobId: string | undefined;

    try {
      const authRes = await agent.com.atproto.server.getServiceAuth({
        aud: VIDEO_SERVICE_AUDIENCE,
        lxm: "app.bsky.video.uploadVideo"
      }).catch(() => null);

      const parsedAuth = authRes?.data ? serviceAuthResponseSchema.safeParse(authRes.data).data : undefined;
      const name = meta.name ?? "video.mp4";
      const url = `${VIDEO_SERVICE_ENDPOINT}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(actorDid)}&name=${encodeURIComponent(name)}`;
      const headers: Record<string, string> = {
        "Content-Type": meta.mimeType || "video/mp4"
      };
      if (parsedAuth?.token) {
        headers["Authorization"] = `Bearer ${parsedAuth.token}`;
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: bytes.buffer as ArrayBuffer,
        signal: AbortSignal.timeout(30000)
      }).catch(() => null);

      if (res && res.ok) {
        const json: unknown = await res.json().catch(() => null);
        const parsed = videoJobStatusResponseSchema.safeParse(json);
        if (parsed.success) {
          jobId = parsed.data.jobStatus.jobId;
          blobRef = parsed.data.jobStatus.blob;
        }
      }
    } catch { /* fallback to agent or uploadBlob */ }

    if (!jobId && !blobRef) {
      try {
        const uploadRes = await agent.app.bsky.video.uploadVideo(bytes, {
          encoding: "video/mp4"
        }).catch(() => null);
        if (uploadRes?.data?.jobStatus) {
          jobId = uploadRes.data.jobStatus.jobId;
          blobRef = uploadRes.data.jobStatus.blob as unknown as Record<string, unknown> | undefined;
        }
      } catch { /* fallback to uploadBlob */ }
    }

    if (!jobId && !blobRef) {
      const blobRes = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: meta.mimeType || "video/mp4" }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        throw new NetslumError("VIDEO_UNAVAILABLE", `Video upload failed: ${message.slice(0, 160)}`, 502, true);
      });
      blobRef = blobRes.data.blob as unknown as Record<string, unknown>;
    }

    if (blobRef) {
      const blobPayload = {
        blob: blobRef,
        alt: meta.alt ?? "",
        kind: "video",
        ...(jobId !== undefined ? { jobId } : {}),
        uploadedAt: Date.now()
      };
      const blobEnc = await encryptJson(blobPayload, this.key());
      await this.env.DB.prepare(
        "UPDATE media_draft SET blob_enc=? WHERE draft_id=? AND did=?"
      ).bind(blobEnc, draftId, actorDid).run();
      return { draftId, jobId, blobRef, status: "ready" };
    }

    if (jobId) {
      const updatedMeta: PreparedVideoPayload = { ...meta, jobId };
      const payloadEnc = await encryptJson(updatedMeta, this.key());
      await this.env.DB.prepare(
        "UPDATE media_draft SET payload_enc=? WHERE draft_id=? AND did=?"
      ).bind(payloadEnc, draftId, actorDid).run();
      return { draftId, jobId, status: "processing" };
    }

    throw new NetslumError("VIDEO_UNAVAILABLE", "Failed to initiate video upload job", 502, true);
  }

  async uploadVideoChunk(actorDid: string, draftId: string, chunk: Uint8Array, partNumber: number, totalParts?: number): Promise<{ draftId: string; partNumber: number; completed: boolean; jobId?: string | undefined }> {
    const row = await this.loadDraft(actorDid, draftId);
    if (!row.payload_enc) throw new NetslumError("NOT_FOUND", "Media draft has no metadata", 404);
    const isSingleOrLast = typeof totalParts === "number" ? partNumber >= totalParts : false;
    if (isSingleOrLast || totalParts === undefined) {
      const uploadRes = await this.uploadVideo(actorDid, draftId, chunk);
      return {
        draftId,
        partNumber,
        completed: uploadRes.status === "ready" || uploadRes.status === "processing",
        jobId: uploadRes.jobId
      };
    }
    return { draftId, partNumber, completed: false };
  }

  async completeVideo(actorDid: string, draftId: string, jobId?: string): Promise<{ draftId: string; status: string; blobRef?: Record<string, unknown> | undefined }> {
    const row = await this.loadDraft(actorDid, draftId);
    let meta: z.infer<typeof storedMetadataSchema> = {};
    if (row.payload_enc) {
      const decrypted = await decryptJson<unknown>(row.payload_enc, this.key());
      meta = storedMetadataSchema.parse(decrypted);
    }
    const resolvedJobId = jobId ?? meta.jobId;

    if (row.blob_enc) {
      const existing = await decryptJson<unknown>(row.blob_enc, this.key());
      const parsedBlob = storedBlobRecordSchema.safeParse(existing).data;
      if (parsedBlob?.blob) {
        return { draftId, status: "ready", blobRef: parsedBlob.blob };
      }
    }

    if (!resolvedJobId) {
      throw new NetslumError("INVALID_INPUT", "No video job ID associated with this draft", 400);
    }

    const job = await this.getJobStatus(actorDid, resolvedJobId);
    if (job.state === "JOB_STATE_COMPLETED" || job.state === "STATE_COMPLETED") {
      const blobRef = job.blob ?? job.blobRef;
      if (blobRef) {
        const blobPayload = {
          blob: blobRef,
          alt: meta.alt ?? "",
          kind: "video",
          jobId: resolvedJobId,
          completedAt: Date.now()
        };
        const blobEnc = await encryptJson(blobPayload, this.key());
        await this.env.DB.prepare(
          "UPDATE media_draft SET blob_enc=? WHERE draft_id=? AND did=?"
        ).bind(blobEnc, draftId, actorDid).run();
        return { draftId, status: "ready", blobRef };
      }
    }

    if (job.state === "JOB_STATE_FAILED" || job.state === "STATE_FAILED") {
      throw new NetslumError("VIDEO_UNAVAILABLE", job.error ?? job.message ?? "Video processing failed", 502);
    }

    return { draftId, status: "processing" };
  }

  async attachBlob(actorDid: string, draftId: string, blobRef: Record<string, unknown>, alt?: string): Promise<void> {
    const blobPayload = {
      blob: blobRef,
      alt: alt ?? "",
      updatedAt: Date.now()
    };
    const blobEnc = await encryptJson(blobPayload, this.key());
    const updated = await this.env.DB.prepare(
      "UPDATE media_draft SET blob_enc=? WHERE draft_id=? AND did=? AND expires_at > ?"
    ).bind(blobEnc, draftId, actorDid, Date.now()).run();
    if (updated.meta.changes === 0) throw new NetslumError("NOT_FOUND", "Media draft expired or missing", 404);
  }

  async mediaBlobRef(actorDid: string, draftId: string): Promise<MediaBlobRefResult> {
    const row = await this.loadDraft(actorDid, draftId);
    if (!row.blob_enc) throw new NetslumError("NOT_FOUND", "Media draft has no completed blob", 404);
    const blobData = await decryptJson<unknown>(row.blob_enc, this.key());
    const parsedBlob = storedBlobRecordSchema.parse(blobData);
    let meta: z.infer<typeof storedMetadataSchema> = {};
    if (row.payload_enc) {
      try {
        const decrypted = await decryptJson<unknown>(row.payload_enc, this.key());
        meta = storedMetadataSchema.parse(decrypted);
      } catch { /* ignore */ }
    }
    const kind = (row.kind === "video" || row.kind === "image") ? row.kind : (meta.kind ?? "image");
    const rawBlob = parsedBlob.blob ?? parsedBlob.video ?? parsedBlob.image;
    if (!rawBlob) throw new NetslumError("NOT_FOUND", "Media draft has no completed blob", 404);
    const alt = parsedBlob.alt ?? meta.alt ?? "";
    if (kind === "video") {
      return {
        kind: "video",
        blob: rawBlob,
        video: rawBlob,
        alt
      };
    }
    return {
      kind: "image",
      blob: rawBlob,
      image: rawBlob,
      alt
    };
  }

  async getBlob(actorDid: string, draftId: string): Promise<Record<string, unknown>> {
    const ref = await this.mediaBlobRef(actorDid, draftId);
    return ref.blob;
  }
}
