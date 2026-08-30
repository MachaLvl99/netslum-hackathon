import { describe, expect, it } from "vitest";
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
});
