import { JoseKey, NodeOAuthClient, requestLocalLock, type NodeSavedSession, type NodeSavedSessionStore, type NodeSavedState, type NodeSavedStateStore } from "@atproto/oauth-client-node";
import type { CloudflareEnv } from "../../types.js";
import { decryptJson, encryptJson, hashToken } from "./crypto.js";

export const OAUTH_SCOPE = "atproto repo:app.bsky.feed.post?action=create repo:app.bsky.feed.like?action=create&action=delete repo:app.bsky.feed.repost?action=create&action=delete repo:sh.macha.netslumSite?action=create&action=update&action=delete blob:*/*";

function stateStore(env: CloudflareEnv): NodeSavedStateStore {
  return {
    async set(key, value) {
      const payload = await encryptJson(value, env.OAUTH_STORE_KEY);
      await env.DB.prepare("INSERT INTO oauth_state(key_hash,payload,expires_at) VALUES(?,?,?) ON CONFLICT(key_hash) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at").bind(await hashToken(key), payload, Date.now() + 15 * 60_000).run();
    },
    async get(key) {
      const hash = await hashToken(key);
      const row = await env.DB.prepare("SELECT payload,expires_at FROM oauth_state WHERE key_hash=?").bind(hash).first<{ payload: ArrayBuffer; expires_at: number }>();
      await env.DB.prepare("DELETE FROM oauth_state WHERE key_hash=?").bind(hash).run();
      if (!row || row.expires_at <= Date.now()) return undefined;
      return decryptJson<NodeSavedState>(row.payload, env.OAUTH_STORE_KEY);
    },
    async del(key) { await env.DB.prepare("DELETE FROM oauth_state WHERE key_hash=?").bind(await hashToken(key)).run(); }
  };
}

function sessionStore(env: CloudflareEnv): NodeSavedSessionStore {
  return {
    async set(did, value) {
      const payload = await encryptJson(value, env.OAUTH_STORE_KEY);
      await env.DB.prepare("INSERT INTO oauth_session(did,payload,updated_at) VALUES(?,?,?) ON CONFLICT(did) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(did, payload, Date.now()).run();
    },
    async get(did) {
      const row = await env.DB.prepare("SELECT payload FROM oauth_session WHERE did=?").bind(did).first<{ payload: ArrayBuffer }>();
      return row ? decryptJson<NodeSavedSession>(row.payload, env.OAUTH_STORE_KEY) : undefined;
    },
    async del(did) { await env.DB.prepare("DELETE FROM oauth_session WHERE did=?").bind(did).run(); }
  };
}

const clients = new WeakMap<object, Promise<NodeOAuthClient>>();
export function getOAuthClient(env: CloudflareEnv): Promise<NodeOAuthClient> {
  const cached = clients.get(env);
  if (cached) return cached;
  const created = (async () => {
    const rawUrl = env.PUBLIC_URL.replace(/\/$/, "");
    const publicUrl = rawUrl.startsWith("http://") ? "https://netslum.macha.sh" : rawUrl;
    let rawJwk = env.OAUTH_CLIENT_PRIVATE_JWK.trim();
    if (rawJwk.startsWith('"') && rawJwk.endsWith('"')) rawJwk = rawJwk.slice(1, -1);
    rawJwk = rawJwk.replaceAll('\\"', '"');
    const parsedJwk: unknown = JSON.parse(rawJwk);
    const jwkObject = (typeof parsedJwk === "string" ? JSON.parse(parsedJwk) : parsedJwk) as Record<string, unknown>;
    const key = await JoseKey.fromJWK(jwkObject);
    return new NodeOAuthClient({
      clientMetadata: {
        client_id: `${publicUrl}/oauth-client-metadata.json`,
        client_name: "netslum",
        client_uri: publicUrl,
        application_type: "web",
        redirect_uris: [`${publicUrl}/oauth/callback`],
        response_types: ["code"],
        grant_types: ["authorization_code", "refresh_token"],
        scope: OAUTH_SCOPE,
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_signing_alg: "ES256",
        jwks_uri: `${publicUrl}/.well-known/jwks.json`,
        dpop_bound_access_tokens: true
      },
      keyset: [key],
      handleResolver: env.BSKY_PUBLIC_API,
      stateStore: stateStore(env),
      sessionStore: sessionStore(env),
      requestLock: requestLocalLock
    });
  })();
  clients.set(env, created);
  return created;
}
