import { rewriteSiteHtml, siteContentSecurityPolicy } from "@netslum/sandbox";
import { sha256Hex, sitePathSchema } from "@netslum/contracts";

interface AssetEnv { DB: D1Database; SITE_FILES: R2Bucket; SITE_RUNTIME_ORIGIN: string; }
interface SiteRow { did: string; active_revision: string; active_worker: string | null; status: "active" | "suspended"; }

const notFound = (): Response => new Response("not found", { status: 404 });

async function activeSite(env: AssetEnv, siteId: string, revision: string): Promise<SiteRow | null> {
  const rows = await env.DB.prepare("SELECT did,active_revision,active_worker,status FROM site WHERE status='active' AND active_revision=?").bind(revision).all<SiteRow>();
  for (const row of rows.results) if (`site-${(await sha256Hex(row.did)).slice(0, 24)}` === siteId) return row;
  return null;
}

export default {
  async fetch(request: Request, env: AssetEnv): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    const url = new URL(request.url);
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
