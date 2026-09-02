import { NetslumError } from "@netslum/contracts";
import { randomToken, hashToken } from "./crypto.js";
import type { CloudflareEnv } from "../../types.js";

const PROBE_COOKIE = "__Host-netslum-p2probe";
const PROBE_MAX_AGE_SECONDS = 2 * 60 * 60;

export async function probeGated(env: CloudflareEnv, request: Request): Promise<void> {
  const configured = env.PHASE2_PROBE_TOKEN;
  if (!configured) {
    throw new NetslumError("NOT_FOUND", "Not found", 404);
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) {
    throw new NetslumError("FORBIDDEN", "Probe access is not allowed", 403);
  }
  const matches = (await hashToken(token)) === (await hashToken(configured));
  if (!matches) {
    throw new NetslumError("FORBIDDEN", "Probe access is not allowed", 403);
  }
}

export async function issueProbeSession(env: CloudflareEnv, did: string): Promise<Headers> {
  if (!env.PHASE2_PROBE_COOKIE_KEY) {
    throw new NetslumError("WORKER_FAILED", "Probe cookie key is not configured", 500);
  }
  const token = await randomToken();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO phase2_probe_web(id_hash,did,created_at,expires_at) VALUES(?,?,?,?)"
  ).bind(await hashToken(token), did, now, now + PROBE_MAX_AGE_SECONDS * 1000).run();
  const headers = new Headers();
  headers.append("Set-Cookie", `${PROBE_COOKIE}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${PROBE_MAX_AGE_SECONDS}`);
  return headers;
}

export async function authenticateProbeRequest(request: Request, env: CloudflareEnv): Promise<{ did: string }> {
  if (!env.PHASE2_PROBE_COOKIE_KEY) {
    throw new NetslumError("NOT_FOUND", "Not found", 404);
  }
  const match = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${PROBE_COOKIE}=([^;]+)`));
  const token = match?.[1];
  if (!token) throw new NetslumError("AUTH_REQUIRED", "Probe sign in is required", 401);
  const row = await env.DB.prepare(
    "SELECT did,expires_at FROM phase2_probe_web WHERE id_hash=?"
  ).bind(await hashToken(token)).first<{ did: string; expires_at: number }>();
  if (!row || row.expires_at <= Date.now()) {
    await env.DB.prepare("DELETE FROM phase2_probe_web WHERE id_hash=?").bind(await hashToken(token)).run();
    throw new NetslumError("AUTH_REQUIRED", "Probe session expired", 401);
  }
  return { did: row.did };
}

export function requireProbeCsrf(request: Request, env: CloudflareEnv): void {
  if (!env.PHASE2_PROBE_COOKIE_KEY) {
    throw new NetslumError("NOT_FOUND", "Not found", 404);
  }
  // Temporary operator-only probe: the auth cookie stays HttpOnly, so the
  // mutation guard is the strict same-site cookie plus an exact Origin check
  // (the plan's CSRF-mirror pattern applies to the production app only).
  if (request.headers.get("origin") !== env.PUBLIC_URL.replace(/\/$/, "")) {
    throw new NetslumError("FORBIDDEN", "Request origin is not allowed", 403);
  }
}

export async function logoutProbe(request: Request, env: CloudflareEnv): Promise<Headers> {
  const match = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${PROBE_COOKIE}=([^;]+)`));
  const token = match?.[1];
  if (token) {
    await env.DB.prepare("DELETE FROM phase2_probe_web WHERE id_hash=?").bind(await hashToken(token)).run();
  }
  const headers = new Headers();
  headers.append("Set-Cookie", `${PROBE_COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  return headers;
}
