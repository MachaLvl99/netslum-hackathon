import { sha256Hex } from "@netslum/contracts";

interface RuntimeEnv { DB: D1Database; PRODUCTION_DISPATCHER: DispatchNamespace; SITE_RATE: RateLimit; }
interface SiteRow { did: string; active_worker: string | null; status: "active" | "suspended"; }
const ONE_MIB = 1024 * 1024;
const METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

function jsonError(code: string, status: number): Response {
  return Response.json({ code }, { status, headers: { "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" } });
}

async function lookupSite(env: RuntimeEnv, siteId: string): Promise<SiteRow | null> {
  const rows = await env.DB.prepare("SELECT did,active_worker,status FROM site WHERE status='active' AND active_worker IS NOT NULL").all<SiteRow>();
  for (const row of rows.results) if (`site-${(await sha256Hex(row.did)).slice(0, 24)}` === siteId) return row;
  return null;
}

function forwardedHeaders(input: Headers): Headers {
  const output = new Headers();
  for (const [name, value] of input) {
    const lower = name.toLowerCase();
    if (lower === "cookie" || lower === "proxy-authorization" || lower === "origin" || lower === "referer" || lower === "cf-connecting-ip" || lower.startsWith("x-forwarded-") || lower.startsWith("sec-") || lower.startsWith("x-netslum-")) continue;
    output.append(name, value);
  }
  return output;
}

async function boundedBody(response: Response): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > ONE_MIB) throw new RangeError("response too large");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > ONE_MIB) throw new RangeError("response too large");
  return bytes;
}

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/(site-[a-f0-9]{24})(\/api(?:\/.*)?)$/.exec(url.pathname);
    if (!match || !["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method)) return jsonError("NOT_FOUND", 404);
    const [, siteId = "", apiPath = ""] = match;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": METHODS, "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") ?? "authorization,content-type", "Access-Control-Max-Age": "86400" } });
    }
    const allowed = await env.SITE_RATE.limit({ key: siteId });
    if (!allowed.success) return jsonError("RATE_LIMITED", 429);
    const site = await lookupSite(env, siteId);
    if (!site?.active_worker) return jsonError("NOT_FOUND", 404);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > ONE_MIB) return jsonError("INVALID_INPUT", 413);
    const requestBody = request.method === "GET" ? undefined : await request.arrayBuffer();
    if (requestBody && requestBody.byteLength > ONE_MIB) return jsonError("INVALID_INPUT", 413);
    const headers = forwardedHeaders(request.headers);
    headers.set("X-Netslum-Site-Id", siteId);
    url.pathname = apiPath;
    let tenantResponse: Response;
    try {
      const worker = env.PRODUCTION_DISPATCHER.get(site.active_worker, {}, { limits: { cpuMs: 50, subRequests: 10 } });
      const init: RequestInit = { method: request.method, headers, redirect: "manual" };
      if (requestBody) init.body = requestBody;
      tenantResponse = await worker.fetch(new Request(url, init));
    } catch { return jsonError("WORKER_FAILED", 502); }
    let body: ArrayBuffer;
    try { body = await boundedBody(tenantResponse); } catch { return jsonError("WORKER_FAILED", 502); }
    const responseHeaders = new Headers(tenantResponse.headers);
    for (const name of ["set-cookie", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) responseHeaders.delete(name);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", METHODS);
    responseHeaders.set("Access-Control-Allow-Headers", "authorization,content-type");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    return new Response(body, { status: tenantResponse.status, statusText: tenantResponse.statusText, headers: responseHeaders });
  }
} satisfies ExportedHandler<RuntimeEnv>;

export { forwardedHeaders };
