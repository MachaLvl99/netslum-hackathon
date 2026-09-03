import { describe, expect, it } from "vitest";
import { MediaService } from "./MediaService.js";
import { encryptJson } from "../auth/crypto.js";
import type { CloudflareEnv } from "../../types.js";

function createMockEnv(): { env: CloudflareEnv; store: Map<string, Record<string, unknown>> } {
  const store = new Map<string, Record<string, unknown>>();
  const privateKey = btoa("01234567890123456789012345678901");

  const mockDb = {
    prepare(query: string) {
      let boundParams: unknown[] = [];
      return {
        bind(...params: unknown[]) {
          boundParams = params;
          return this;
        },
        run() {
          if (query.includes("INSERT INTO media_draft")) {
            const [draftId, did, kind, payloadEnc, createdAt, expiresAt] = boundParams as [string, string, string, ArrayBuffer, number, number];
            store.set(draftId, {
              draft_id: draftId,
              did,
              kind,
              payload_enc: payloadEnc,
              blob_enc: null,
              created_at: createdAt,
              expires_at: expiresAt
            });
            return Promise.resolve({ meta: { changes: 1 } });
          }
          if (query.includes("UPDATE media_draft SET blob_enc")) {
            const [blobEnc, draftId, did] = boundParams as [ArrayBuffer, string, string];
            const existing = store.get(draftId);
            if (existing && existing.did === did) {
              existing.blob_enc = blobEnc;
              return Promise.resolve({ meta: { changes: 1 } });
            }
            return Promise.resolve({ meta: { changes: 0 } });
          }
          return Promise.resolve({ meta: { changes: 0 } });
        },
        first<T>() {
          if (query.includes("FROM media_draft WHERE draft_id=?")) {
            const [draftId, did, now] = boundParams as [string, string, number];
            const existing = store.get(draftId);
            if (existing && existing.did === did && (existing.expires_at as number) > now) {
              return Promise.resolve(existing as T);
            }
            return Promise.resolve(null);
          }
          return Promise.resolve(null);
        }
      };
    }
  };

  const env = {
    DB: mockDb as unknown as D1Database,
    PRIVATE_DATA_KEY: privateKey
  } as unknown as CloudflareEnv;

  return { env, store };
}

describe("MediaService", () => {
  const actorDid = "did:plc:alice12345";

  describe("prepareImage", () => {
    it("prepares valid image draft with 10-minute TTL", async () => {
      const { env, store } = createMockEnv();
      const service = new MediaService(env);

      const res = await service.prepareImage(actorDid, {
        mimeType: "image/png",
        sizeBytes: 50_000,
        alt: "A lovely sunset"
      });

      expect(res.draftId).toBeDefined();
      expect(typeof res.draftId).toBe("string");

      const row = store.get(res.draftId);
      expect(row).toBeDefined();
      expect(row?.did).toBe(actorDid);
      expect(row?.kind).toBe("image");
      expect((row?.expires_at as number) - (row?.created_at as number)).toBe(10 * 60_000);
    });

    it("accepts byteLength alias and confirmNoAlt", async () => {
      const { env } = createMockEnv();
      const service = new MediaService(env);

      const res = await service.prepareImage(actorDid, {
        mimeType: "image/jpeg",
        byteLength: 100_000,
        confirmNoAlt: true
      });

      expect(res.draftId).toBeDefined();
    });

    it("rejects image exceeding 1MB limit", async () => {
      const { env } = createMockEnv();
      const service = new MediaService(env);

      await expect(
        service.prepareImage(actorDid, {
          mimeType: "image/png",
          sizeBytes: 1_000_001,
          alt: "Too large"
        })
      ).rejects.toThrow();
    });

    it("rejects zero or negative size", async () => {
      const { env } = createMockEnv();
      const service = new MediaService(env);

      await expect(
        service.prepareImage(actorDid, {
          mimeType: "image/png",
          sizeBytes: 0,
          alt: "Empty"
        })
      ).rejects.toThrow();
    });

    it("rejects invalid MIME types", async () => {
      const { env } = createMockEnv();
      const service = new MediaService(env);

      await expect(
        service.prepareImage(actorDid, {
          mimeType: "application/pdf" as unknown as "image/png",
          sizeBytes: 10_000,
          alt: "PDF"
        })
      ).rejects.toThrow();
    });
  });

  describe("prepareVideo", () => {
    it("prepares valid video draft within 100MB limit", async () => {
      const { env, store } = createMockEnv();
      const service = new MediaService(env);

      const res = await service.prepareVideo(actorDid, {
        mimeType: "video/mp4",
        sizeBytes: 50_000_000,
        name: "clip.mp4",
        alt: "A video clip"
      });

      expect(res.draftId).toBeDefined();
      const row = store.get(res.draftId);
      expect(row).toBeDefined();
      expect(row?.kind).toBe("video");
      expect((row?.expires_at as number) - (row?.created_at as number)).toBe(10 * 60_000);
    });

    it("rejects video exceeding 100MB", async () => {
      const { env } = createMockEnv();
      const service = new MediaService(env);

      await expect(
        service.prepareVideo(actorDid, {
          mimeType: "video/mp4",
          sizeBytes: 100_000_001
        })
      ).rejects.toThrow();
    });
  });

  describe("attachBlob & mediaBlobRef", () => {
    it("attaches completed blob reference and resolves mediaBlobRef for images", async () => {
      const { env } = createMockEnv();
      const service = new MediaService(env);

      const prep = await service.prepareImage(actorDid, {
        mimeType: "image/png",
        sizeBytes: 20_000,
        alt: "Landscape photo"
      });

      const blobRef = {
        $type: "blob",
        ref: { $link: "bafkreia123" },
        mimeType: "image/png",
        size: 20_000
      };

      await service.attachBlob(actorDid, prep.draftId, blobRef, "Landscape photo");

      const resolved = await service.mediaBlobRef(actorDid, prep.draftId);
      expect(resolved.kind).toBe("image");
      expect(resolved.blob).toEqual(blobRef);
      expect(resolved.alt).toBe("Landscape photo");
    });

    it("attaches completed blob reference and resolves mediaBlobRef for videos", async () => {
      const { env, store } = createMockEnv();
      const service = new MediaService(env);

      const prep = await service.prepareVideo(actorDid, {
        mimeType: "video/mp4",
        sizeBytes: 5_000_000,
        alt: "Demo video"
      });

      const blobRef = {
        $type: "blob",
        ref: { $link: "bafkreib456" },
        mimeType: "video/mp4",
        size: 5_000_000
      };

      // Encrypt video blob into draft
      const blobPayload = { blob: blobRef, alt: "Demo video", kind: "video" };
      const blobEnc = await encryptJson(blobPayload, env.PRIVATE_DATA_KEY ?? "");
      const row = store.get(prep.draftId);
      if (row) row.blob_enc = blobEnc;

      const resolved = await service.mediaBlobRef(actorDid, prep.draftId);
      expect(resolved.kind).toBe("video");
      expect(resolved.blob).toEqual(blobRef);
      expect(resolved.video).toEqual(blobRef);
      expect(resolved.alt).toBe("Demo video");
    });

    it("throws NOT_FOUND when draft has no completed blob", async () => {
      const { env } = createMockEnv();
      const service = new MediaService(env);

      const prep = await service.prepareImage(actorDid, {
        mimeType: "image/png",
        sizeBytes: 10_000,
        alt: "Incomplete"
      });

      await expect(service.mediaBlobRef(actorDid, prep.draftId)).rejects.toThrow();
    });
  });
});
