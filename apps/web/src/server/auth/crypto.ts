import { NetslumError, sha256Hex } from "@netslum/contracts";

function decodeStoreKey(value: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    let clean = (value ?? "").trim();
    if (clean.startsWith('"') && clean.endsWith('"')) clean = clean.slice(1, -1);
    bytes = Uint8Array.from(atob(clean), (character) => character.charCodeAt(0));
  } catch {
    throw new NetslumError("WORKER_FAILED", "OAuth encryption key is invalid", 500);
  }
  if (bytes.byteLength !== 32) throw new NetslumError("WORKER_FAILED", `OAuth encryption key must be 32 bytes (got ${bytes.byteLength})`, 500);
  return bytes;
}

async function importStoreKey(value: string): Promise<CryptoKey> {
  const bytes = decodeStoreKey(value);
  const copy = bytes.slice();
  return crypto.subtle.importKey("raw", copy.buffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encryptJson(value: unknown, keyValue: string): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await importStoreKey(keyValue), plaintext));
  const output = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
  output.set(nonce); output.set(ciphertext, nonce.byteLength);
  return output;
}

export async function decryptJson<T>(payload: ArrayBuffer | Uint8Array, keyValue: string): Promise<T> {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.byteLength < 29) throw new NetslumError("AUTH_REQUIRED", "Stored OAuth state is invalid", 401);
  const nonce = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await importStoreKey(keyValue), ciphertext);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as T;
  } catch { throw new NetslumError("AUTH_REQUIRED", "Stored OAuth state cannot be restored", 401); }
}

export async function randomToken(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return Promise.resolve(token);
}

export async function hashToken(value: string): Promise<string> {
  return sha256Hex(value);
}
