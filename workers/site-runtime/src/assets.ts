import { rewriteSiteHtml, siteContentSecurityPolicy } from "@netslum/sandbox";
import { sha256Hex, sitePathSchema, slugSchema } from "@netslum/contracts";


// Pinned first-party HTMX build (plan §E3): served only from tenant origins,
// with its SHA-256 verified at startup so a swapped file fails deployment.
const HTMX_SHA256 = "449317ade7881e949510db614991e195c3a099c4c791c24dacec55f9f4a2a452";
const HTMX_SCRIPT = "htmx-1.9.12.min.js";
export interface AssetEnv {
  DB: D1Database;
  SITE_FILES: R2Bucket;
  SITE_RUNTIME_ORIGIN: string;
  SITE_RUNTIME?: Fetcher | undefined;
}
interface SiteRow { did: string; active_revision: string; active_worker: string | null; status: "active" | "suspended"; }
interface PreviewCapabilityRow { did: string; revision: string; created_at: number; expires_at: number; }

const PREVIEW_COOKIE = "__Host-netslum-preview";

const notFound = (): Response => new Response("not found", { status: 404 });

function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0) {
      result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return result;
}

async function servePinnedHtmx(request: Request, env: AssetEnv): Promise<Response> {
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
 * Preview uses preview-(site-[a-f0-9]{24}).sites.<tenant-domain> and serves
 * draft revisions authenticated via preview capability tokens and cookies.
 */
export default {
  async fetch(request: Request, env: AssetEnv): Promise<Response> {
    const url = new URL(request.url);
    const host = (request.headers.get("host") ?? "").toLowerCase();

    // Preview origin: preview-(site-[a-f0-9]{24}).sites.<tenant-domain>
    const previewMatch = /^preview-(site-[a-f0-9]{24})\.sites\.(.+)$/.exec(host);
    if (previewMatch && previewMatch[1] !== undefined) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }
      const siteId = previewMatch[1];
      const capToken = url.searchParams.get("cap");
      const now = Date.now();

      if (capToken) {
        const capHash = await sha256Hex(capToken);
        const capRow = await env.DB.prepare(
          "SELECT did, revision, created_at, expires_at FROM preview_capability WHERE capability_hash = ? AND expires_at > ? LIMIT 1"
        ).bind(capHash, now).first<PreviewCapabilityRow>();
        if (!capRow) return new Response("invalid or expired preview capability", { status: 403 });
        const expectedSiteId = `site-${(await sha256Hex(capRow.did)).slice(0, 24)}`;
        if (expectedSiteId !== siteId) return notFound();

        const cleanUrl = new URL(request.url);
        cleanUrl.searchParams.delete("cap");
        return new Response(null, {
          status: 302,
          headers: {
            Location: cleanUrl.href,
            "Set-Cookie": `${PREVIEW_COOKIE}=${encodeURIComponent(capToken)}; Secure; HttpOnly; SameSite=Lax; Path=/`,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer"
          }
        });
      }

      const cookies = parseCookies(request.headers.get("cookie"));
      const cookieToken = cookies[PREVIEW_COOKIE];
      if (!cookieToken) return new Response("preview authorization required", { status: 401 });

      const capHash = await sha256Hex(cookieToken);
      const capRow = await env.DB.prepare(
        "SELECT did, revision, created_at, expires_at FROM preview_capability WHERE capability_hash = ? AND expires_at > ? LIMIT 1"
      ).bind(capHash, now).first<PreviewCapabilityRow>();
      if (!capRow) return new Response("preview authorization expired", { status: 401 });
      const expectedSiteId = `site-${(await sha256Hex(capRow.did)).slice(0, 24)}`;
      if (expectedSiteId !== siteId) return notFound();

      if (url.pathname === `/_netslum/${HTMX_SCRIPT}`) {
        return await servePinnedHtmx(request, env);
      }

      const rawPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      let path: string;
      try {
        path = sitePathSchema.parse(decodeURIComponent(rawPath));
      } catch {
        return notFound();
      }

      // Never execute or serve draft _worker.js
      if (path === "_worker.js") return notFound();

      const object = await env.SITE_FILES.get(`draft/${siteId}/${capRow.revision}/${path}`);
      if (!object) return notFound();

      const mimeType = object.customMetadata?.mimeType ?? "application/octet-stream";
      const headers = new Headers({
        "Content-Type": mimeType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "tools=()",
        ETag: object.httpEtag
      });
      if (object.customMetadata?.sha256) headers.set("Digest", `sha-256=${object.customMetadata.sha256}`);
      let body: BodyInit | null = request.method === "HEAD" ? null : object.body;
      if (mimeType === "text/html") {
        const previewOrigin = `https://${host}`;
        const rewritten = rewriteSiteHtml(await object.text(), {
          baseUrl: `${previewOrigin}/`,
          siteId,
          revision: capRow.revision,
          apiBase: null
        });
        body = request.method === "HEAD" ? null : rewritten;
        headers.set(
          "Content-Security-Policy",
          `sandbox allow-scripts; frame-ancestors https://netslum.macha.sh; ${siteContentSecurityPolicy(`${previewOrigin}/`)}`
        );
        headers.set("Content-Length", String(new TextEncoder().encode(rewritten).byteLength));
      } else {
        headers.set("Content-Length", String(object.size));
      }
      return new Response(body, { status: 200, headers });
    }

    // Tenant origin: <slug>.sites.<tenant-domain>
    const tenantMatch = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.sites\.(.+)$/.exec(host);
    if (tenantMatch && tenantMatch[2] !== undefined) {
      const slug = slugSchema.safeParse(tenantMatch[1]);
      if (!slug.success) return notFound();
      const site = await activeSiteBySlug(env, slug.data);
      if (!site) return notFound();
      const siteId = `site-${(await sha256Hex(site.did)).slice(0, 24)}`;

      if (url.pathname.startsWith("/api/")) {
        const targetUrl = new URL(`https://runtime.internal/${siteId}${url.pathname}${url.search}`);
        const forwardHeaders = new Headers(request.headers);
        forwardHeaders.set("X-Netslum-Site-Id", siteId);
        if (env.SITE_RUNTIME) {
          return await env.SITE_RUNTIME.fetch(new Request(targetUrl, {
            method: request.method,
            headers: forwardHeaders,
            body: (request.method === "GET" || request.method === "HEAD") ? undefined : request.body,
            // @ts-expect-error duplex
            duplex: "half",
            redirect: "manual"
          }));
        }
        return await fetch(new Request(new URL(`/${siteId}${url.pathname}${url.search}`, env.SITE_RUNTIME_ORIGIN), {
          method: request.method,
          headers: forwardHeaders,
          body: (request.method === "GET" || request.method === "HEAD") ? undefined : request.body,
          // @ts-expect-error duplex
          duplex: "half",
          redirect: "manual"
        }));
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }

      if (url.pathname === `/_netslum/${HTMX_SCRIPT}`) {
        return await servePinnedHtmx(request, env);
      }
      const rawPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      let path: string;
      try { path = sitePathSchema.parse(decodeURIComponent(rawPath)); } catch { return notFound(); }
      const revision = site.active_revision;
      const object = await env.SITE_FILES.get(`release/${siteId}/${revision}/${path}`);
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
      if (object.customMetadata?.sha256) headers.set("Digest", `sha-256=${object.customMetadata.sha256}`);
      let body: BodyInit | null = request.method === "HEAD" ? null : object.body;
      if (mimeType === "text/html") {
        const tenantOrigin = `https://${host}`;
        const apiBase = site.active_worker ? `${tenantOrigin}/api` : null;
        const rewritten = rewriteSiteHtml(await object.text(), { baseUrl: `${tenantOrigin}/`, siteId, revision, apiBase });
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

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
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
