import { NetslumError } from "@netslum/contracts";
import { grantedScopeContainsRequired, OAUTH_SCOPE_VERSION } from "./permissions.js";
import type { CloudflareEnv } from "../../types.js";
import { getOAuthClient } from "./oauth.js";
import { hashToken, randomToken } from "./crypto.js";

const SESSION_COOKIE = "__Host-netslum";
const CSRF_COOKIE = "__Host-netslum-csrf";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function cookies(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0) result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return result;
}

export interface AuthenticatedSession { did: string; sessionIdHash: string; csrfToken: string; grantedScope: string | null; scopeVersion: number; dmAgentEnabled: boolean; }

export interface IssuedWebSession { headers: Headers; csrfToken: string; }

export async function issueWebSession(
  env: CloudflareEnv,
  did: string,
  capabilities?: { grantedScope: string; scopeVersion: number }
): Promise<IssuedWebSession> {
  const sessionToken = await randomToken();
  const csrfToken = await randomToken();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO web_session(id_hash,did,csrf_hash,created_at,expires_at,granted_scope,scope_version,dm_agent_enabled) VALUES(?,?,?,?,?,?,?,0)"
  ).bind(
    await hashToken(sessionToken),
    did,
    await hashToken(csrfToken),
    now,
    now + MAX_AGE_SECONDS * 1000,
    capabilities?.grantedScope ?? null,
    capabilities?.scopeVersion ?? 1
  ).run();
  const headers = new Headers();
  headers.append("Set-Cookie", `${SESSION_COOKIE}=${sessionToken}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`);
  // SameSite=Lax (not Strict): Strict withholds the cookie on cross-site
  // top-level arrivals, which signed users out until a same-site reload.
  // Lax still blocks the cookie on cross-site POSTs, so CSRF protection holds.
  headers.append("Set-Cookie", `${CSRF_COOKIE}=${csrfToken}; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`);
  return { headers, csrfToken };
}

export async function authenticateRequest(
  request: Request,
  env: CloudflareEnv,
  mutation = false,
  requireCurrentGrant = true
): Promise<AuthenticatedSession> {
  const values = cookies(request);
  const sessionToken = values[SESSION_COOKIE];
  const csrfToken = values[CSRF_COOKIE];
  if (!sessionToken) throw new NetslumError("AUTH_REQUIRED", "Sign in is required", 401);
  if (mutation && !csrfToken) throw new NetslumError("FORBIDDEN", "CSRF token is required for mutations", 403);
  const sessionIdHash = await hashToken(sessionToken);
  const row = await env.DB.prepare("SELECT did,csrf_hash,expires_at,granted_scope,scope_version,dm_agent_enabled FROM web_session WHERE id_hash=?").bind(sessionIdHash).first<{ did: string; csrf_hash: string; expires_at: number; granted_scope: string | null; scope_version: number; dm_agent_enabled: number }>();
  if (!row || row.expires_at <= Date.now()) throw new NetslumError("AUTH_REQUIRED", "Session expired", 401);
  if (requireCurrentGrant && (row.scope_version < OAUTH_SCOPE_VERSION || row.granted_scope === null || !grantedScopeContainsRequired(row.granted_scope))) {
    throw new NetslumError("REAUTHORIZE_REQUIRED", "Sign in again to authorize current features", 403);
  }
  if (mutation) {
    if (request.headers.get("origin") !== env.PUBLIC_URL.replace(/\/$/, "")) throw new NetslumError("FORBIDDEN", "Request origin is not allowed", 403);
    const supplied = request.headers.get("x-csrf-token");
    if (!supplied || supplied !== csrfToken || await hashToken(supplied) !== row.csrf_hash) throw new NetslumError("FORBIDDEN", "CSRF validation failed", 403);
  }
  return { did: row.did, sessionIdHash, csrfToken: csrfToken ?? "", grantedScope: row.granted_scope, scopeVersion: row.scope_version, dmAgentEnabled: row.dm_agent_enabled === 1 };
}

export async function logout(request: Request, env: CloudflareEnv): Promise<Headers> {
  const values = cookies(request);
  const sessionToken = values[SESSION_COOKIE];
  if (sessionToken) {
    const row = await env.DB.prepare("SELECT did FROM web_session WHERE id_hash=?").bind(await hashToken(sessionToken)).first<{ did: string }>();
    if (row) { const client = await getOAuthClient(env); await client.revoke(row.did).catch(() => undefined); await env.DB.prepare("DELETE FROM oauth_session WHERE did=?").bind(row.did).run(); }
    await env.DB.prepare("DELETE FROM web_session WHERE id_hash=?").bind(await hashToken(sessionToken)).run();
  }
  const headers = new Headers();
  headers.append("Set-Cookie", `${SESSION_COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  headers.append("Set-Cookie", `${CSRF_COOKIE}=; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  return headers;
}

const didDocCache = new Map<string, { doc: { service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }>; alsoKnownAs?: string[] }; ts: number }>();
const DID_CACHE_TTL = 10 * 60_000;

export async function resolveDidDocument(did: string): Promise<{ service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }>; alsoKnownAs?: string[] }> {
  const cached = didDocCache.get(did);
  if (cached && Date.now() - cached.ts < DID_CACHE_TTL) return cached.doc;
  let url: string;
  if (did.startsWith("did:plc:")) url = `https://plc.directory/${encodeURIComponent(did)}`;
  else if (did.startsWith("did:web:")) {
    const segments = did.slice(8).split(":").map(decodeURIComponent);
    url = `https://${segments[0]}${segments.length > 1 ? `/${segments.slice(1).join("/")}` : "/.well-known"}/did.json`;
  } else throw new NetslumError("FORBIDDEN", "Unsupported DID method", 403);
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new NetslumError("UPSTREAM_UNAVAILABLE", "Identity resolver unavailable", 503, true);
  const doc: { service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }>; alsoKnownAs?: string[] } = await response.json();
  didDocCache.set(did, { doc, ts: Date.now() });
  return doc;
}

export async function canPublishSite(did: string, env: CloudflareEnv): Promise<boolean> {
  const document = await resolveDidDocument(did);
  const endpoint = document.service?.find((service) => service.id === "#atproto_pds" || service.id === `${did}#atproto_pds`)?.serviceEndpoint;
  return typeof endpoint === "string" && endpoint.replace(/\/$/, "") === env.PDS_URL.replace(/\/$/, "");
}

export function sessionCapabilities(grantedScope: string | null, scopeVersion: number, dmAgentEnabled: boolean): {
  reauthorizeRequired: boolean;
  dmAgentEnabled: boolean;
  canUseDms: boolean;
  canUploadVideo: boolean;
} {
  const reauthorizeRequired =
    scopeVersion < OAUTH_SCOPE_VERSION ||
    grantedScope === null ||
    !grantedScopeContainsRequired(grantedScope);
  return {
    reauthorizeRequired,
    dmAgentEnabled: !reauthorizeRequired && dmAgentEnabled,
    canUseDms: !reauthorizeRequired,
    canUploadVideo: !reauthorizeRequired
  };
}
