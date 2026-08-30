import { z } from "zod";
import { NetslumError } from "./errors.js";

export const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const slugSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
export const mimeTypeSchema = z.string().max(100).regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/);
export const sitePathSchema = z.string().max(128).refine((path) => {
  const segments = path.split("/");
  return path.length > 0 && new TextEncoder().encode(path).length <= 128 && !path.startsWith("/") && !path.includes("\\") && segments.every((part) => part.length > 0 && part !== "." && part !== ".." && /^[A-Za-z0-9._-]+$/.test(part));
}, "Invalid site path").refine((path) => !/(^|\/)(\.env($|\.)|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519))$/i.test(path), "Credential-like files are forbidden");

export const siteFileSchema = z.object({
  path: sitePathSchema,
  mimeType: mimeTypeSchema,
  size: z.number().int().min(0).max(524_288),
  sha256: revisionSchema
}).strict();

export const saveSiteFileSchema = z.object({
  path: sitePathSchema,
  content: z.string().max(2_000_000),
  encoding: z.enum(["utf8", "base64"]),
  contentType: mimeTypeSchema,
  expectedRevision: revisionSchema
}).strict();
export const deleteSiteFileSchema = z.object({ path: sitePathSchema, expectedRevision: revisionSchema }).strict();
export const readSiteFileSchema = z.object({ path: sitePathSchema, offset: z.number().int().nonnegative().default(0), maxChars: z.number().int().min(1).max(1000).default(1000) }).strict();
export const publishSiteSchema = z.object({ revision: revisionSchema }).strict();
export type SiteFile = z.infer<typeof siteFileSchema>;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const input = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const source = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function siteRevision(files: readonly SiteFile[]): Promise<string> {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  validateSiteBundle(sorted);
  return sha256Hex(canonicalJson(sorted.map(({ path, mimeType, size, sha256 }) => ({ path, mimeType, size, sha256 }))));
}

export function validateSiteBundle(files: readonly SiteFile[]): void {
  if (files.length < 1 || files.length > 64) throw new NetslumError("INVALID_INPUT", "A site must contain 1–64 files", 400);
  const names = new Set<string>();
  let aggregate = 0;
  for (const file of files) {
    siteFileSchema.parse(file);
    if (names.has(file.path)) throw new NetslumError("INVALID_INPUT", "Duplicate site path", 400);
    names.add(file.path); aggregate += file.size;
    if (file.path === "index.html" && file.mimeType !== "text/html") throw new NetslumError("INVALID_INPUT", "index.html must be text/html", 400);
    if (file.path === "_worker.js" && !["text/javascript", "application/javascript"].includes(file.mimeType)) throw new NetslumError("INVALID_INPUT", "_worker.js must be JavaScript", 400);
    if (file.path === "_worker.js" && file.size > 262_144) throw new NetslumError("INVALID_INPUT", "_worker.js exceeds 256 KiB", 400);
  }
  if (!names.has("index.html")) throw new NetslumError("INVALID_INPUT", "index.html is required", 400);
  if (aggregate > 5 * 1024 * 1024) throw new NetslumError("INVALID_INPUT", "Site exceeds 5 MiB", 400);
}

export function decodeCanonicalBase64(value: string): Uint8Array {
  if (/\s/.test(value) || value.length % 4 !== 0) throw new NetslumError("INVALID_INPUT", "Base64 must be canonical and padded", 400);
  let binary: string;
  try { binary = atob(value); } catch { throw new NetslumError("INVALID_INPUT", "Invalid base64", 400); }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const encoded = btoa(String.fromCharCode(...bytes));
  if (encoded !== value) throw new NetslumError("INVALID_INPUT", "Base64 must be canonical and padded", 400);
  return bytes;
}
