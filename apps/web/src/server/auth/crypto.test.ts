import { describe, expect, it } from "vitest";
import { createWorkerFetch } from "./oauth.js";
import { decryptJson, encryptJson, hashToken, randomToken } from "./crypto.js";

const key = "A".repeat(43) + "="; // 32 bytes base64

describe("crypto utils", () => {
  it("encrypts and decrypts JSON payloads", async () => {
    const payload = { did: "did:plc:123", access: "token-abc" };
    const encrypted = await encryptJson(payload, key);
    expect(encrypted.byteLength).toBeGreaterThan(28);
    const decrypted = await decryptJson<typeof payload>(encrypted, key);
    expect(decrypted).toEqual(payload);
  });

  it("fails decryption with wrong key or tampered ciphertext", async () => {
    const payload = { did: "did:plc:123" };
    const encrypted = await encryptJson(payload, key);
    const wrongKey = "B".repeat(43) + "=";
    await expect(decryptJson(encrypted, wrongKey)).rejects.toThrow();
    encrypted[15] = (encrypted[15] ?? 0) ^ 0xff;
    await expect(decryptJson(encrypted, key)).rejects.toThrow();
  });

  it("produces url-safe random tokens and hashes them deterministically", async () => {
    const token = await randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    const hash1 = await hashToken(token);
    const hash2 = await hashToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });
  it("normalizes redirect: error from Request objects and throws on 3xx", async () => {
    let capturedInit: RequestInit | undefined;
    const mockFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response(null, { status: 302, headers: { location: "https://example.com/other" } }));
    };

    const workerFetch = createWorkerFetch(mockFetch as unknown as typeof fetch);

    // Request instance with redirect: "error"
    const req = new Request("https://example.com/test", { redirect: "error" });
    await expect(workerFetch(req)).rejects.toThrow(TypeError);
    expect(capturedInit?.redirect).toBe("manual");

    // Override with init.redirect: "follow" should take precedence
    const overrideRes = await workerFetch(req, { redirect: "follow" });
    expect(overrideRes.status).toBe(302);
    expect(capturedInit?.redirect).toBe("follow");

    // Normal 200 response with redirect: "error" should pass through with manual redirect
    const mock200Fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response("ok", { status: 200 }));
    };
    const worker200Fetch = createWorkerFetch(mock200Fetch as unknown as typeof fetch);
    const res = await worker200Fetch(req);
    expect(res.status).toBe(200);
    expect(capturedInit?.redirect).toBe("manual");
  });
});
