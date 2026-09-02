import { NetslumError } from "@netslum/contracts";
import { WebcryptoKey, NodeOAuthClient, requestLocalLock, type NodeSavedSession, type NodeSavedSessionStore, type NodeSavedState, type NodeSavedStateStore } from "@atproto/oauth-client-node";
import { AtprotoDohHandleResolver } from "@atproto-labs/handle-resolver";
import type { CloudflareEnv } from "../../types.js";
import { decryptJson, encryptJson, hashToken } from "./crypto.js";
import { LEGACY_OAUTH_SCOPE, PHASE2_OAUTH_SCOPE } from "./permissions.js";

export function createWorkerFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const originalRedirect = init?.redirect ?? (input instanceof Request ? input.redirect : "follow");
    const isErrorRedirect = (originalRedirect as string) === "error";
    const effectiveRedirect: RequestRedirect = isErrorRedirect ? "manual" : originalRedirect;
    const req = new Request(input, { ...init, redirect: effectiveRedirect });
    const response = await baseFetch(req, { redirect: effectiveRedirect });
    if (isErrorRedirect && response.status >= 300 && response.status < 400) {
      throw new TypeError(`Fetch redirected with status ${response.status} when redirect mode was 'error'`);
    }
    return response;
  };
}


function stateStore(env: CloudflareEnv): NodeSavedStateStore {
  return {
    async set(key, value) {
      const payload = await encryptJson(value, env.OAUTH_STORE_KEY);
      const hash = await hashToken(key);
      const expiresAt = Date.now() + 15 * 60_000;
      await env.DB.prepare("INSERT INTO oauth_state(key_hash,payload,expires_at) VALUES(?,?,?) ON CONFLICT(key_hash) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at").bind(hash, payload.slice().buffer, expiresAt).run();
    },
    async get(key) {
      const hash = await hashToken(key);
      const row = await env.DB.prepare("SELECT payload,expires_at FROM oauth_state WHERE key_hash=?").bind(hash).first<{ payload: ArrayBuffer | Uint8Array; expires_at: number }>();
      await env.DB.prepare("DELETE FROM oauth_state WHERE key_hash=?").bind(hash).run();
      if (!row || row.expires_at <= Date.now()) return undefined;
      const rawPayload = row.payload instanceof Uint8Array ? row.payload : new Uint8Array(row.payload);
      return decryptJson<NodeSavedState>(rawPayload, env.OAUTH_STORE_KEY);
    },
    async del(key) { await env.DB.prepare("DELETE FROM oauth_state WHERE key_hash=?").bind(await hashToken(key)).run(); }
  };
}

function sessionStore(env: CloudflareEnv, table: "oauth_session" | "oauth_probe_session"): NodeSavedSessionStore {
  const isProbe = table === "oauth_probe_session";
  return {
    async set(did, value) {
      const payload = await encryptJson(value, env.OAUTH_STORE_KEY);
      const now = Date.now();
      if (isProbe) {
        await env.DB.prepare(
          "INSERT INTO oauth_probe_session(did,payload,updated_at,expires_at) VALUES(?,?,?,?) " +
          "ON CONFLICT(did) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,expires_at=excluded.expires_at"
        ).bind(did, payload.slice().buffer, now, now + 60 * 60_000).run();
      } else {
        await env.DB.prepare(
          "INSERT INTO oauth_session(did,payload,updated_at) VALUES(?,?,?) " +
          "ON CONFLICT(did) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at"
        ).bind(did, payload.slice().buffer, now).run();
      }
    },
    async get(did) {
      const row = isProbe
        ? await env.DB.prepare("SELECT payload,expires_at FROM oauth_probe_session WHERE did=?").bind(did).first<{ payload: ArrayBuffer | Uint8Array; expires_at: number }>()
        : await env.DB.prepare("SELECT payload FROM oauth_session WHERE did=?").bind(did).first<{ payload: ArrayBuffer | Uint8Array; expires_at?: number }>();
      if (!row || (row.expires_at !== undefined && row.expires_at <= Date.now())) {
        if (isProbe && row) await env.DB.prepare("DELETE FROM oauth_probe_session WHERE did=?").bind(did).run();
        return undefined;
      }
      const rawPayload = row.payload instanceof Uint8Array ? row.payload : new Uint8Array(row.payload);
      return decryptJson<NodeSavedSession>(rawPayload, env.OAUTH_STORE_KEY);
    },
    async del(did) { await env.DB.prepare(`DELETE FROM ${table} WHERE did=?`).bind(did).run(); }
  };
}

interface OAuthClientVariant {
  clientMetadataPath: string;
  redirectPath: string;
  scope: string;
  sessionTable: "oauth_session" | "oauth_probe_session";
  clientName: string;
}

const productionClients = new WeakMap<object, Promise<NodeOAuthClient>>();
const probeClients = new WeakMap<object, Promise<NodeOAuthClient>>();

function createOAuthClient(env: CloudflareEnv, variant: OAuthClientVariant): Promise<NodeOAuthClient> {
  return (async () => {
    const rawUrl = env.PUBLIC_URL.replace(/\/$/, "");
    const publicUrl = rawUrl.startsWith("http://") ? "https://netslum.macha.sh" : rawUrl;
    let rawJwk = env.OAUTH_CLIENT_PRIVATE_JWK.trim();
    if (rawJwk.startsWith('"') && rawJwk.endsWith('"')) rawJwk = rawJwk.slice(1, -1);
    rawJwk = rawJwk.replaceAll('\\"', '"');
    const parsedJwk: unknown = JSON.parse(rawJwk);
    const jwkObject = (typeof parsedJwk === "string" ? JSON.parse(parsedJwk) : parsedJwk) as JsonWebKey & { kid?: string };
    const privateKey = await crypto.subtle.importKey(
      "jwk" as const,
      jwkObject,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"]
    );
    if (!jwkObject.kty || !jwkObject.crv || !jwkObject.x || !jwkObject.y) {
      throw new NetslumError("WORKER_FAILED", "Invalid EC JWK", 500);
    }
    const publicJwk: JsonWebKey = { kty: jwkObject.kty, crv: jwkObject.crv, x: jwkObject.x, y: jwkObject.y };
    const publicKey = await crypto.subtle.importKey(
      "jwk" as const,
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );
    const key = await WebcryptoKey.fromKeypair({ privateKey, publicKey }, jwkObject.kid as string);
    const workerFetch = createWorkerFetch();
    const handleResolver = new AtprotoDohHandleResolver({
      dohEndpoint: "https://cloudflare-dns.com/dns-query",
      fetch: workerFetch
    });
    return new NodeOAuthClient({
      fetch: workerFetch,
      clientMetadata: {
        client_id: `${publicUrl}${variant.clientMetadataPath}`,
        client_name: variant.clientName,
        client_uri: publicUrl,
        application_type: "web",
        redirect_uris: [`${publicUrl}${variant.redirectPath}`],
        response_types: ["code"],
        grant_types: ["authorization_code", "refresh_token"],
        scope: variant.scope,
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_signing_alg: "ES256",
        jwks_uri: `${publicUrl}/.well-known/jwks.json`,
        dpop_bound_access_tokens: true
      },
      keyset: [key],
      handleResolver,
      stateStore: stateStore(env),
      sessionStore: sessionStore(env, variant.sessionTable),
      requestLock: requestLocalLock,
      runtimeImplementation: {
        requestLock: requestLocalLock,
        createKey: async () => {
          const keyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign", "verify"]
          );
          return WebcryptoKey.fromKeypair(keyPair, crypto.randomUUID());
        },
        getRandomValues: (length: number) => crypto.getRandomValues(new Uint8Array(length)),
        digest: async (bytes: Uint8Array, algorithm: { name: string }) => {
          const algName = algorithm.name.replace(/^sha-?/i, "SHA-");
          const copy = bytes.slice();
          return new Uint8Array(await crypto.subtle.digest(algName, copy.buffer));
        }
      }
    });
  })();
}

export function getOAuthClient(env: CloudflareEnv): Promise<NodeOAuthClient> {
  const cached = productionClients.get(env);
  if (cached) return cached;
  const created = createOAuthClient(env, {
    clientMetadataPath: "/oauth-client-metadata.json",
    redirectPath: "/oauth/callback",
    scope: LEGACY_OAUTH_SCOPE,
    sessionTable: "oauth_session",
    clientName: "netslum"
  });
  productionClients.set(env, created);
  return created;
}

export function getPhase2ProbeOAuthClient(env: CloudflareEnv): Promise<NodeOAuthClient> {
  const cached = probeClients.get(env);
  if (cached) return cached;
  const created = createOAuthClient(env, {
    clientMetadataPath: "/oauth-v2-probe-client-metadata.json",
    redirectPath: "/oauth/v2-probe/callback",
    scope: PHASE2_OAUTH_SCOPE,
    sessionTable: "oauth_probe_session",
    clientName: "netslum phase 2 capability probe"
  });
  probeClients.set(env, created);
  return created;
}
