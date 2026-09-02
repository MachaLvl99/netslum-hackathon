import { Hono } from "hono";
import {
  feedQuerySchema,
  NetslumError,
  parseZoneKey,
  preparePostSchema,
  publishPostSchema,
  publishSiteSchema,
  reactionSchema,
  readSiteFileSchema,
  saveSiteFileSchema,
  deleteSiteFileSchema,
  sha256Hex,
  slugSchema,
  zoneMutationSchema
} from "@netslum/contracts";
import { z } from "zod";
import { rewriteSiteHtml } from "@netslum/sandbox";
import type { CloudflareEnv } from "./types.js";
import { getOAuthClient } from "./server/auth/oauth.js";
import { authenticateRequest, canPublishSite, issueWebSession, logout } from "./server/auth/session.js";
import { AtprotoService } from "./server/social/AtprotoService.js";
import { SiteService } from "./server/sites/SiteService.js";
import { ZoneRoom } from "./server/zones/ZoneRoom.js";

const app = new Hono<{ Bindings: CloudflareEnv }>();

// Security headers middleware
app.use("*", async (c, next) => {
  await next();
  c.header("Permissions-Policy", "tools=(self)");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
});

// Error handling middleware
app.onError((err, c) => {
  if (err instanceof NetslumError) {
    const status = (err.status >= 400 && err.status <= 599 ? err.status : 500) as 500;
    return c.json({ code: err.code, message: err.message, retryable: err.retryable, data: err.data }, status);
  }
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  console.error("Unhandled worker error:", JSON.stringify({
    name: err?.name,
    message: err?.message,
    stack: err?.stack,
    cause: cause instanceof Error ? { name: cause.name, message: cause.message, stack: cause.stack, cause: (cause as Error & { cause?: unknown }).cause } : cause
  }));
  return c.json({ code: "WORKER_FAILED", message: "Internal server error", retryable: false }, 500);
});

// Health check
app.get("/health", (c) => c.json({ ok: true }));

// Static & Lynx bundle proxy routes
app.get("/main.web.bundle", (c) => c.env.ASSETS.fetch(new Request(new URL("/main.web.bundle", c.req.url), c.req.raw)));
app.get("/host.js", (c) => c.env.ASSETS.fetch(new Request(new URL("/host.js", c.req.url), c.req.raw)));
app.get("/static/*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/binary/*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/decodeWorker/*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/common/*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/constants.js", (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/wasm.js", (c) => c.env.ASSETS.fetch(c.req.raw));

// OAuth metadata endpoints
app.get("/oauth-client-metadata.json", async (c) => {
  try {
    const client = await getOAuthClient(c.env);
    return c.json(client.clientMetadata);
  } catch (err) {
    console.error("METADATA_ERROR:", err);
    throw err;
  }
});

app.get("/.well-known/jwks.json", async (c) => {
  try {
    const client = await getOAuthClient(c.env);
    return c.json(client.jwks);
  } catch (err) {
    console.error("JWKS_ERROR:", err);
    throw err;
  }
});

// OAuth Login initiation
app.get("/oauth/login", async (c) => {
  let target = (c.req.query("handle") ?? "").trim();
  const pdsUrl = c.env.PDS_URL ?? "https://pds.netslum.macha.sh";
  const pdsHost = c.env.PDS_HOSTNAME ?? "pds.netslum.macha.sh";

  if (!target || target === pdsHost || target === pdsUrl) {
    target = pdsUrl;
  } else if (!target.startsWith("did:") && !target.startsWith("http://") && !target.startsWith("https://")) {
    target = target.replace(/^@/, "");
    if (!target.includes(".")) {
      target = `${target}.${pdsHost}`;
    }
  }

  const client = await getOAuthClient(c.env);
  const state = crypto.randomUUID();
  const url = await client.authorize(target, { state });
  return c.redirect(url.toString(), 302);
});

// OAuth Callback
app.get("/oauth/callback", async (c) => {
  const client = await getOAuthClient(c.env);
  const params = new URLSearchParams(new URL(c.req.url).search);
  const { session } = await client.callback(params);
  const { headers } = await issueWebSession(c.env, session.did);
  headers.set("Location", "/town");
  return new Response(null, { status: 302, headers });
});

// Session & Logout
app.get("/api/session", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw, c.env, false);
    const client = await getOAuthClient(c.env);
    await client.restore(auth.did).catch(() => undefined);
    const allowed = await canPublishSite(auth.did, c.env).catch(() => false);
    let handle = auth.did;
    if (auth.did.startsWith("did:plc:")) {
      const plc = await fetch(`https://plc.directory/${encodeURIComponent(auth.did)}`, { signal: AbortSignal.timeout(4000) })
        .then((r) => (r.ok ? r.json() : null) as Promise<{ alsoKnownAs?: string[] } | null>)
        .catch(() => null);
      const atHandle = plc?.alsoKnownAs?.find((id) => id.startsWith("at://"));
      if (atHandle) handle = atHandle.slice("at://".length);
    } else if (auth.did.startsWith("did:web:")) {
      handle = decodeURIComponent(auth.did.split(":")[2] ?? auth.did).split(".")[0] ?? handle;
    }
    return c.json({
      authenticated: true,
      did: auth.did,
      handle,
      canPublishSite: allowed
    });
  } catch {
    return c.json({ authenticated: false, canPublishSite: false });
  }
});

app.post("/api/auth/logout", async (c) => {
  const headers = await logout(c.req.raw, c.env);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...Object.fromEntries(headers), "Content-Type": "application/json" } });
});

// Social routes
app.get("/api/feed", async (c) => {
  const parsed = feedQuerySchema.parse(c.req.query());
  const service = new AtprotoService(c.env);
  const result = await service.getTownFeed(parsed.cursor, parsed.limit);
  return c.json(result);
});

app.get("/api/profile/:actor", async (c) => {
  const actor = decodeURIComponent(c.req.param("actor"));
  const service = new AtprotoService(c.env);
  const profile = await service.getProfile(actor);
  const site = await c.env.DB.prepare(
    "SELECT slug, active_revision FROM site WHERE did = ? AND status = 'active' AND active_revision IS NOT NULL"
  ).bind(profile.did).first<{ slug: string }>();
  return c.json({ ...profile, siteUrl: site ? `/@${site.slug}` : null });
});

app.put("/api/post-draft", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const body: unknown = await c.req.json();
  const rawInput = preparePostSchema.parse(body);
  const input: { text: string; replyToUri?: string; expectedRevision: string | null } = {
    text: rawInput.text,
    expectedRevision: rawInput.expectedRevision
  };
  if (rawInput.replyToUri) input.replyToUri = rawInput.replyToUri;
  const service = new AtprotoService(c.env);
  const result = await service.preparePost(auth.did, input);
  return c.json(result);
});
app.post("/api/posts/publish", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const body: unknown = await c.req.json();
  const input = publishPostSchema.parse(body);
  const service = new AtprotoService(c.env);
  const result = await service.publishPreparedPost(auth.did, input.draftRevision);
  return c.json(result);
});

app.post("/api/reactions", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const body: unknown = await c.req.json();
  const input = reactionSchema.parse(body);
  const service = new AtprotoService(c.env);
  const result = await service.reactToPost(auth.did, input);
  return c.json(result);
});


// Zone routes (delegating to ZoneRoom Durable Object)
app.get("/api/zones/:zoneKey", async (c) => {
  const zoneKey = parseZoneKey(c.req.param("zoneKey"));
  const id = c.env.ZONES.idFromName(zoneKey);
  const room = c.env.ZONES.get(id);
  return room.fetch(c.req.raw);
});

app.get("/api/zones/:zoneKey/socket", async (c) => {
  const zoneKey = parseZoneKey(c.req.param("zoneKey"));
  const id = c.env.ZONES.idFromName(zoneKey);
  const room = c.env.ZONES.get(id);
  return room.fetch(c.req.raw);
});

app.post("/api/zones/:zoneKey/mutations", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const zoneKey = parseZoneKey(c.req.param("zoneKey"));
  const body: unknown = await c.req.json();
  zoneMutationSchema.parse(body); // validate schema

  const id = c.env.ZONES.idFromName(zoneKey);
  const room = c.env.ZONES.get(id);

  // Strip inbound X-Netslum-Actor and attach verified actor DID
  const headers = new Headers(c.req.raw.headers);
  headers.delete("X-Netslum-Actor");
  headers.set("X-Netslum-Actor", auth.did);

  const req = new Request(c.req.raw.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return room.fetch(req);
});

// Personal Site draft & publication routes
app.get("/api/sites/draft", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const service = new SiteService(c.env);
  const result = await service.getDraft(auth.did);
  return c.json(result);
});

app.get("/api/sites/file", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const parsed = readSiteFileSchema.parse(c.req.query());
  const service = new SiteService(c.env);
  const result = await service.readFile(auth.did, parsed);
  return c.json(result);
});

app.put("/api/sites/file", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const body: unknown = await c.req.json();
  const parsed = saveSiteFileSchema.parse(body);
  const service = new SiteService(c.env);
  const result = await service.saveFile(auth.did, parsed);
  return c.json(result);
});

app.delete("/api/sites/file", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const body: unknown = await c.req.json();
  const parsed = deleteSiteFileSchema.parse(body);
  const service = new SiteService(c.env);
  const result = await service.deleteFile(auth.did, parsed);
  return c.json(result);
});

app.post("/api/sites/publish", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const body: unknown = await c.req.json();
  const parsed = publishSiteSchema.parse(body);
  const service = new SiteService(c.env);
  const result = await service.publish(auth.did, parsed);
  return c.json(result);
});

// Authenticated preview route for draft workspace
app.get("/api/sites/preview/:revision/*", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const revision = c.req.param("revision");
  const pathParam = c.req.path.replace(`/api/sites/preview/${revision}/`, "");
  const service = new SiteService(c.env);
  const { siteId } = await service.getOrCreateSite(auth.did);

  const file = await c.env.SITE_FILES.get(`draft/${siteId}/${revision}/${pathParam || "index.html"}`);
  if (!file) return c.text("Not found", 404);

  const mimeType = file.customMetadata?.mimeType ?? "text/html";
  if (mimeType === "text/html") {
    const rawHtml = await file.text();
    const baseUrl = `${new URL(c.req.url).origin}/api/sites/preview/${revision}/`;
    const rewritten = rewriteSiteHtml(rawHtml, {
      baseUrl,
      siteId,
      revision,
      apiBase: null
    });
    return c.html(rewritten, 200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: blob:; connect-src https:; frame-src https:; form-action 'none'; object-src 'none'; base-uri ${new URL(baseUrl).origin}`
    });
  }

  return new Response(file.body, { headers: { "Content-Type": mimeType, "Cache-Control": "no-store" } });
});

// Admin endpoints
app.post("/api/admin/sites/suspend", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const adminDids = (c.env.SITE_ADMIN_DIDS ?? "").split(",").map((d: string) => d.trim()).filter(Boolean);
  if (!adminDids.includes(auth.did)) throw new NetslumError("FORBIDDEN", "Admin authorization required", 403);
  const body: unknown = await c.req.json();
  const schema = z.object({ targetDid: z.string(), reason: z.string().min(1) });
  const { targetDid, reason } = schema.parse(body);

  const service = new SiteService(c.env);
  await service.suspendSite(auth.did, targetDid, reason);
  return c.json({ ok: true });
});

app.post("/api/admin/sites/restore", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const adminDids = (c.env.SITE_ADMIN_DIDS ?? "").split(",").map((d: string) => d.trim()).filter(Boolean);
  if (!adminDids.includes(auth.did)) throw new NetslumError("FORBIDDEN", "Admin authorization required", 403);
  const body: unknown = await c.req.json();
  const schema = z.object({ targetDid: z.string(), reason: z.string().min(1) });
  const { targetDid, reason } = schema.parse(body);

  const service = new SiteService(c.env);
  await service.restoreSite(auth.did, targetDid, reason);
  return c.json({ ok: true });
});

// Public personal site vanity route: /@<slug>
app.get("/:vanity{@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$}", async (c) => {
  const rawSlug = c.req.param("vanity").slice(1);
  if (!slugSchema.safeParse(rawSlug).success) return c.text("Not found", 404);

  const site = await c.env.DB.prepare("SELECT * FROM site WHERE slug = ? AND status = 'active'").bind(rawSlug).first<{
    did: string;
    slug: string;
    active_revision: string | null;
    active_worker: string | null;
  }>();
  if (!site || !site.active_revision) return c.text("Site not found or inactive", 404);

  const siteId = `site-${(await sha256Hex(site.did)).slice(0, 24)}`;
  const indexObj = await c.env.SITE_FILES.get(`release/${siteId}/${site.active_revision}/index.html`);
  if (!indexObj) return c.text("Site entry not found", 404);

  const rawHtml = await indexObj.text();
  const baseUrl = `${c.env.SITE_ASSET_ORIGIN}/release/${siteId}/${site.active_revision}/`;
  const apiBase = site.active_worker ? `${c.env.SITE_RUNTIME_ORIGIN}/${siteId}/api` : null;
  const rewritten = rewriteSiteHtml(rawHtml, { baseUrl, siteId, revision: site.active_revision, apiBase });
  const escapedSrcDoc = rewritten.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

  const shellHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#070910">
  <title>@${site.slug} — netslum</title>
  <style>
    body { margin: 0; background: #070910; color: #E8F0FF; font-family: ui-monospace, Menlo, Consolas, monospace; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    header { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid #2A3652; background: #101522; z-index: 10; }
    .brand { color: #57E6FF; font-weight: bold; text-decoration: none; font-size: 14px; }
    .site-info { color: #8792AA; font-size: 13px; }
    iframe { flex: 1; border: none; width: 100%; height: calc(100vh - 44px); background: #ffffff; }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">netslum</a>
    <span class="site-info">@${site.slug} (rev: ${site.active_revision.slice(0, 8)})</span>
    <a href="/town" style="color:#57E6FF;text-decoration:none;font-size:13px;">town square &rarr;</a>
  </header>
  <iframe sandbox="allow-scripts" srcdoc="${escapedSrcDoc}"></iframe>
</body>
</html>`;
  return c.html(shellHtml);
});

app.get("*", (c) => {
  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#070910">
  <title>netslum</title>
  <link rel="stylesheet" href="/static/css/client.css">
</head>
<body style="margin:0;background:#070910">
  <main id="lynx-host">
    <noscript>netslum requires JavaScript. AT Protocol APIs remain available directly from your PDS.</noscript>
  </main>
  <script type="module" src="/static/js/client.js"></script>
  <script type="module" src="/host.js"></script>
</body>
</html>`);
});

export { ZoneRoom };
export default app;
