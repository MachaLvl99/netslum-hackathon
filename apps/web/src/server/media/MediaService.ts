import { Agent } from "@atproto/api";
import { NetslumError, prepareImageSchema, prepareVideoSchema } from "@netslum/contracts";
import type { z } from "zod";
import type { CloudflareEnv } from "../../types.js";
import { getOAuthClient } from "../auth/oauth.js";
import { encryptJson, decryptJson } from "../auth/crypto.js";

const IMAGE_LIMIT_BYTES = 1_000_000;
export const VIDEO_CHUNK_BYTES = 5_242_880; // 5 MiB — matches the live video service part size.
const MEDIA_DRAFT_TTL_MS = 30 * 60_000;

interface MediaDraftRow {
  payload_enc: ArrayBuffer | null;
  blob_enc: ArrayBuffer | null;
}

/**
 * Phase 2 (plan §C4): image and video upload pipeline.
 *
 * Images: the browser posts the bytes to Netslum; the Worker streams them to
 * the actor's PDS uploadBlob with the user's OAuth session — tokens never
 * reach browser JavaScript. Draft metadata is encrypted at rest (§G) with the
 * independent PRIVATE_DATA_KEY and expires.
 *
 * Videos: the browser posts only metadata; the Worker mints the service-auth
 * token and allocates the upload job, the browser streams each part directly
 * to the video service (the A4-proven two-stage path), then the Worker
 * publishes the completed blob ref.
 */
export class MediaService {
  constructor(private readonly env: CloudflareEnv) {}

  private key(env: CloudflareEnv): string {
    if (!env.PRIVATE_DATA_KEY) throw new NetslumError("WORKER_FAILED", "Private data key is not configured", 500);
    return env.PRIVATE_DATA_KEY;
  }

  async agentFor(actorDid: string): Promise<Agent> {
    const client = await getOAuthClient(this.env);
    const session = await client.restore(actorDid).catch(() => undefined);
    if (!session) throw new NetslumError("AUTH_REQUIRED", "Please sign in again", 401);
    return new Agent(session);
  }

  private async insertDraft(actorDid: string, kind: "image" | "video", payload: unknown): Promise<string> {
    const draftId = crypto.randomUUID();
    const payloadEnc = await encryptJson(payload, this.env.PRIVATE_DATA_KEY ?? "");
    await this.env.DB.prepare(
      "INSERT INTO media_draft(draft_id,did,kind,payload_enc,created_at,expires_at) VALUES(?,?,?,?,?,?)"
    ).bind(draftId, actorDid, kind, payloadEnc, Date.now(), Date.now() + MEDIA_DRAFT_TTL_MS).run();
    return draftId;
  }

  async prepareImage(actorDid: string, input: z.infer<typeof prepareImageSchema>): Promise<{ draftId: string }> {
    prepareImageSchema.parse(input);
    return { draftId: await this.insertDraft(actorDid, "image", input) };
  }

  async prepareVideo(actorDid: string, input: z.infer<typeof prepareVideoSchema>): Promise<{ draftId: string }> {
    prepareVideoSchema.parse(input);
    return { draftId: await this.insertDraft(actorDid, "video", input) };
  }

  private async loadDraft(actorDid: string, draftId: string): Promise<MediaDraftRow> {
    const row = await this.env.DB.prepare(
      "SELECT payload_enc, blob_enc FROM media_draft WHERE draft_id=? AND did=? AND expires_at > ?"
    ).bind(draftId, actorDid, Date.now()).first<MediaDraftRow>();
    if (!row) throw new NetslumError("NOT_FOUND", "Media draft expired or missing", 404);
    return row;
  }

  async uploadImage(actorDid: string, draftId: string, bytes: Uint8Array): Promise<{ blobRef: Record<string, unknown> }> {
    const row = await this.loadDraft(actorDid, draftId);
    if (!row.payload_enc) throw new NetslumError("NOT_FOUND", "Media draft has no metadata", 404);
    const meta = prepareImageSchema.parse(await decryptJson(row.payload_enc, this.env.PRIVATE_DATA_KEY ?? ""));
    if (bytes.byteLength > IMAGE_LIMIT_BYTES || bytes.byteLength !== meta.sizeBytes) {
      throw new NetslumError("INVALID_INPUT", "Image bytes do not match the prepared draft", 400);
    }
    const agent = await this.agentFor(actorDid);
    const response = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: meta.mimeType }).catch((error) => {
      throw new NetslumError("UPSTREAM_UNAVAILABLE", `Image upload failed: ${String((error as Error).message ?? error).slice(0, 160)}`, 502, true);
    });
    const blobEnc = await encryptJson(response.data.blob, this.env.PRIVATE_DATA_KEY ?? "");
    await this.env.DB.prepare("UPDATE media_draft SET blob_enc=? WHERE draft_id=?").bind(blobEnc, draftId).run();
    return { blobRef: response.data.blob as unknown as Record<string, unknown> };
  }

  async attachBlob(actorDid: string, draftId: string, blobRef: Record<string, unknown>): Promise<void> {
    const blobEnc = await encryptJson(blobRef, this.env.PRIVATE_DATA_KEY ?? "");
    const updated = await this.env.DB.prepare(
      "UPDATE media_draft SET blob_enc=? WHERE draft_id=? AND did=? AND expires_at > ?"
    ).bind(blobEnc, draftId, actorDid, Date.now()).run();
    if (updated.meta.changes === 0) throw new NetslumError("NOT_FOUND", "Media draft expired or missing", 404);
  }

  async getBlob(actorDid: string, draftId: string): Promise<Record<string, unknown>> {
    const row = await this.loadDraft(actorDid, draftId);
    if (!row.blob_enc) throw new NetslumError("NOT_FOUND", "Media draft has no completed blob", 404);
    return decryptJson<Record<string, unknown>>(row.blob_enc, this.env.PRIVATE_DATA_KEY ?? "");
  }
}