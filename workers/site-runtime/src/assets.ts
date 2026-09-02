import { rewriteSiteHtml, siteContentSecurityPolicy } from "@netslum/sandbox";
import { sha256Hex, sitePathSchema, slugSchema } from "@netslum/contracts";


// Pinned first-party HTMX build (plan §E3): served only from tenant origins,
// with its SHA-256 verified at startup so a swapped file fails deployment.
const HTMX_SHA256 = "449317ade7881e949510db614991e195c3a099c4c791c24dacec55f9f4a2a452";
const HTMX_SCRIPT = "htmx-1.9.12.min.js";
interface AssetEnv { DB: D1Database; SITE_FILES: R2Bucket; SITE_RUNTIME_ORIGIN: string; }
interface SiteRow { did: string; active_revision: string; active_worker: string | null; status: "active" | "suspended"; }

const notFound = (): Response => new Response("not found", { status: 404 });

async function activeSite(env: AssetEnv, siteId: string, revision: string): Promise<SiteRow | null> {
  const rows = await env.DB.prepare("SELECT did,active_revision,active_worker,status FROM site WHERE status='active' AND active_revision=?").bind(revision).all<SiteRow>();
  for (const row of rows.results) if (`site-${(await sha256Hex(row.did)).slice(0, 24)}` === siteId) return row;
  return null;
}

interface SlugRow { did: string; slug: string; active_revision: string | null; active_worker: string | null; status: string; }

async function activeSiteBySlug(env: AssetEnv, slug: string): Promise<SiteRow | null> {
  const row = await env.DB.prepare(
    "SELECT did,slug,active_revision,active_worker,status FROM site WHERE slug=? AND status='active' AND active_revision IS NOT NULL LIMIT 1"
  ).bind(slug).first<SlugRow>();
  if (!row) return null;
  return { did: row.did, active_revision: row.active_revision ?? "", active_worker: row.active_worker, status: row.status as "active" | "suspended" };
}

/**
 * Tenant origins (plan §E1): the tenant is derived exclusively from Host —
 * <slug>.sites.netslum.macha.sh serves the slug's ACTIVE revision at
 * canonical paths; no caller-selected site ID or revision is accepted.
 * Preview uses its separate hostname and remains on the Phase-1 path.
 */
export default {
  async fetch(request: Request, env: AssetEnv): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    const url = new URL(request.url);
    const host = (request.headers.get("host") ?? "").toLowerCase();

    // Tenant origin: <slug>.sites.<tenant-domain>
    const tenantMatch = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.sites\.(.+)$/.exec(host);
    if (tenantMatch && tenantMatch[2] !== undefined) {
      const slug = slugSchema.safeParse(tenantMatch[1]);
      if (!slug.success) return notFound();
      const site = await activeSiteBySlug(env, slug.data);
      if (!site) return notFound();
      if (url.pathname === `/_netslum/${HTMX_SCRIPT}`) {
        const pinned = await env.SITE_FILES.get(`_netslum/${HTMX_SCRIPT}`);
        if (!pinned) return new Response("pinned htmx missing", { status: 503 });
        const pinnedBytes = new Uint8Array(await pinned.arrayBuffer());
        const digest = await sha256Hex(pinnedBytes);
        if (digest !== HTMX_SHA256) return new Response("htmx hash mismatch", { status: 503 });
        return new Response(request.method === "HEAD" ? null : pinnedBytes, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "public,max-age=31536000,immutable",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer"
          }
        });
      }
      const rawPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      let path: string;
      try { path = sitePathSchema.parse(decodeURIComponent(rawPath)); } catch { return notFound(); }
      const revision = site.active_revision;
      const object = await env.SITE_FILES.get(`release/site-${(await sha256Hex(site.did)).slice(0, 24)}/${revision}/${path}`);
      if (!object) return notFound();
      const mimeType = object.customMetadata?.mimeType ?? "application/octet-stream";
      const headers = new Headers({
        "Content-Type": mimeType,
        "Cache-Control": "public,max-age=60",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "tools=()",
        ETag: object.httpEtag
      });
      let body: BodyInit | null = request.method === "HEAD" ? null : object.body;
      if (mimeType === "text/html") {
        const tenantOrigin = `https://${host}`;
        const rewritten = rewriteSiteHtml(await object.text(), { baseUrl: `${tenantOrigin}/`, siteId: `site-${(await sha256Hex(site.did)).slice(0, 24)}`, revision, apiBase: `${tenantOrigin}/api` });
        body = request.method === "HEAD" ? null : rewritten;
        // sandbox allow-scripts allow-same-origin is justified ONLY because
        // this document lives on a tenant origin distinct from the app and
        // every other tenant (plan §E1 amendment 3).
        headers.set("Content-Security-Policy", `sandbox allow-scripts allow-same-origin; frame-ancestors https://netslum.macha.sh; ${siteContentSecurityPolicy(`${tenantOrigin}/`)}`);
        headers.set("Content-Length", String(new TextEncoder().encode(rewritten).byteLength));
      } else {
        headers.set("Content-Length", String(object.size));
      }
      return new Response(body, { status: 200, headers });
    }

    // Phase-1 release path (workers.dev origin, previews, legacy embeds).
    const match = /^\/release\/(site-[a-f0-9]{24})\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
    if (!match) return notFound();
    const [, siteId = "", revision = "", rawPath = ""] = match;
    let path: string;
    try { path = sitePathSchema.parse(decodeURIComponent(rawPath)); } catch { return notFound(); }
    const site = await activeSite(env, siteId, revision);
    if (!site) return notFound();
    const object = await env.SITE_FILES.get(`release/${siteId}/${revision}/${path}`);
    if (!object) return notFound();
    const mimeType = object.customMetadata?.mimeType ?? "application/octet-stream";
    let body: BodyInit | null = request.method === "HEAD" ? null : object.body;
    const headers = new Headers({
      "Content-Type": mimeType,
      "Cache-Control": "public,max-age=31536000,immutable",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "tools=()",
      ETag: object.httpEtag
    });
    if (object.customMetadata?.sha256) headers.set("Digest", `sha-256=${object.customMetadata.sha256}`);
    if (mimeType === "text/html") {
      const baseUrl = new URL(path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "", `${url.origin}/release/${siteId}/${revision}/`).href;
      const apiBase = site.active_worker ? `${env.SITE_RUNTIME_ORIGIN}/${siteId}/api` : null;
      const rewritten = rewriteSiteHtml(await object.text(), { baseUrl, siteId, revision, apiBase });
      body = request.method === "HEAD" ? null : rewritten;
      headers.set("Content-Security-Policy", `sandbox allow-scripts; ${siteContentSecurityPolicy(baseUrl)}`);
      headers.set("Content-Length", String(new TextEncoder().encode(rewritten).byteLength));
    } else {
      headers.set("Content-Length", String(object.size));
    }
    return new Response(body, { status: 200, headers });
  }
} satisfies ExportedHandler<AssetEnv>;
