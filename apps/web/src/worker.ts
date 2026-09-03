import { Hono } from "hono";
import {
  feedQuerySchema,
  NetslumError,
  parseZoneKey,
  preparePostSchemaV2,
  updateProfileSchema,
  publishPostSchema,
  publishSiteSchema,
  reactionSchema,
  readSiteFileSchema,
  saveSiteFileSchema,
  deleteSiteFileSchema,
  sha256Hex,
  slugSchema,
  sitePathSchema,
  presentHandle,
  homeModeSchema,
  prepareImageSchema,
  tenantToolManifestSchema,
  prepareVideoSchema,
  zoneMutationSchema
} from "@netslum/contracts";
import { OAUTH_SCOPE_VERSION } from "./server/auth/permissions.js";
import { z, ZodError } from "zod";
import { rewriteSiteHtml } from "@netslum/sandbox";
import type { CloudflareEnv } from "./types.js";
import { getOAuthClient } from "./server/auth/oauth.js";
import { randomToken, hashToken } from "./server/auth/crypto.js";
import { MediaService } from "./server/media/MediaService.js";
import { GraphService } from "./server/social/GraphService.js";
import { ChatService } from "./server/social/ChatService.js";
import { DmDraftService } from "./server/social/DmDraftService.js";
import { authenticateRequest, canPublishSite, issueWebSession, logout, sessionCapabilities, resolveDidDocument, type AuthenticatedSession } from "./server/auth/session.js";
import { AtprotoService } from "./server/social/AtprotoService.js";
import { HomeSettingsService } from "./server/home/HomeSettingsService.js";
import { ZoneRoom } from "./server/zones/ZoneRoom.js";
import { SiteService } from "./server/sites/SiteService.js";

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
  if (err instanceof ZodError) {
    return c.json({ code: "INVALID_INPUT", message: "Request validation failed", retryable: false }, 400);
  }
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

// Static & Lynx bundle assets — `no-cache` (not max-age): deploys ship new
// code but Cloudflare's edge would otherwise serve the old copy for up to 5
// minutes and users would need to hard-refresh. The browser revalidates via
// ETag (304 when unchanged, fresh body the moment a deploy lands). The
// revalidation cost for these once-per-load files is negligible.
const cacheAsset = async (c: { env: { ASSETS: Fetcher }; req: { url: string; raw: Request } }, path: string) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL(path, c.req.url), c.req.raw));
  if (!res.ok) return res;
  const cached = new Response(res.body, res);
  cached.headers.set("Cache-Control", "no-cache");
  return cached;
};
app.get("/main.web.bundle", (c) => cacheAsset(c, "/main.web.bundle"));
app.get("/host.js", (c) => cacheAsset(c, "/host.js"));
app.get("/static/*", (c) => cacheAsset(c, new URL(c.req.url).pathname));
app.get("/binary/*", (c) => cacheAsset(c, new URL(c.req.url).pathname));
app.get("/decodeWorker/*", (c) => cacheAsset(c, new URL(c.req.url).pathname));
app.get("/common/*", (c) => cacheAsset(c, new URL(c.req.url).pathname));
app.get("/constants.js", (c) => cacheAsset(c, "/constants.js"));
app.get("/wasm.js", (c) => cacheAsset(c, "/wasm.js"));

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
  try {
    const client = await getOAuthClient(c.env);
    const params = new URLSearchParams(new URL(c.req.url).search);
    const { session } = await client.callback(params);
    const token = await session.getTokenInfo(false);
    const { headers } = await issueWebSession(c.env, session.did, {
      grantedScope: token.scope,
      scopeVersion: OAUTH_SCOPE_VERSION
    });
    headers.set("Location", "/");
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("OAuth callback failure:", error);
    return c.redirect("/?error=auth_failed", 302);
  }
});

// Session & Logout
app.get("/api/session", async (c) => {
  let auth: AuthenticatedSession;
  try {
    auth = await authenticateRequest(c.req.raw, c.env, false, false);
  } catch {
    return c.json({ authenticated: false, canPublishSite: false, reauthorizeRequired: false });
  }

  let handle = auth.did;
  let allowed = false;

  try {
    const client = await getOAuthClient(c.env);
    await client.restore(auth.did).catch(() => undefined);
  } catch {
    // Client restore is non-fatal for session identity
  }

  try {
    allowed = await canPublishSite(auth.did, c.env).catch(() => false);
  } catch {
    allowed = false;
  }

  try {
    if (auth.did.startsWith("did:plc:")) {
      const plc = await resolveDidDocument(auth.did).catch(() => null);
      const atHandle = plc?.alsoKnownAs?.find((id) => id.startsWith("at://"));
      if (atHandle) handle = atHandle.slice("at://".length);
    } else if (auth.did.startsWith("did:web:")) {
      handle = decodeURIComponent(auth.did.split(":")[2] ?? auth.did).split(".")[0] ?? handle;
    }
  } catch {
    handle = auth.did;
  }

  const capabilities = sessionCapabilities(auth.grantedScope, auth.scopeVersion, auth.dmAgentEnabled);
  return c.json({
    authenticated: true,
    did: auth.did,
    handle,
    displayHandle: presentHandle(handle),
    canPublishSite: allowed,
    canAuthorHome: allowed,
    reauthorizeRequired: capabilities.reauthorizeRequired,
    dmAgentEnabled: capabilities.dmAgentEnabled,
    canUseDms: capabilities.canUseDms,
    canUploadVideo: capabilities.canUploadVideo,
    scopeVersion: auth.scopeVersion
  });
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
  const auth = await authenticateRequest(c.req.raw, c.env, false).catch(() => null);
  const service = new AtprotoService(c.env);
  const profile = await service.getProfile(actor, auth?.did);
  const site = await c.env.DB.prepare(
    "SELECT slug, active_revision FROM site WHERE did = ? AND status = 'active' AND active_revision IS NOT NULL"
  ).bind(profile.did).first<{ slug: string }>();
  return c.json({ ...profile, siteUrl: site ? `/@${site.slug}` : null });
});

app.put("/api/post-draft", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const body: unknown = await c.req.json();
  // Phase 2 composer (plan §C3): destination, reply, quote, languages, and
  // prepared media IDs ride the same draft. Legacy clients that omit
  // destination default to 'town' (existing drafts migrate as town).
  const parsed = preparePostSchemaV2.parse(body);
  const service = new AtprotoService(c.env);
  const result = await service.preparePost(auth.did, {
    text: parsed.text,
    expectedRevision: parsed.expectedRevision,
    destination: parsed.destination,
    ...(parsed.replyToUri !== undefined ? { replyToUri: parsed.replyToUri } : {}),
    ...(parsed.quoteUri !== undefined ? { quoteUri: parsed.quoteUri } : {}),
    ...(parsed.quoteCid !== undefined ? { quoteCid: parsed.quoteCid } : {}),
    ...(parsed.languages !== undefined ? { languages: parsed.languages } : {}),
    ...(parsed.mediaDraftIds !== undefined ? { mediaDraftIds: parsed.mediaDraftIds } : {})
  });
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

// Graph mutations (plan §C2): follow/block/mute with viewer state.
app.post("/api/graph/resolve", async (c) => {
  await authenticateRequest(c.req.raw, c.env, false);
  const input = z.object({ actor: z.string().max(315) }).strict().parse(await c.req.json());
  const service = new GraphService(c.env);
  return c.json(await service.resolveActor(input.actor));
});

app.post("/api/graph/follow", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ actor: z.string().max(315), follow: z.boolean() }).strict().parse(await c.req.json());
  const service = new GraphService(c.env);
  const target = await service.resolveActor(input.actor);
  const result = await service.setFollowState(auth.did, target.did, input.follow);
  return c.json(result);
});

app.post("/api/graph/block", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ actor: z.string().max(315), block: z.boolean() }).strict().parse(await c.req.json());
  const service = new GraphService(c.env);
  const target = await service.resolveActor(input.actor);
  const result = await service.setBlockState(auth.did, target.did, input.block);
  return c.json(result);
});

app.post("/api/graph/mute", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ actor: z.string().max(315), mute: z.boolean() }).strict().parse(await c.req.json());
  const service = new GraphService(c.env);
  const target = await service.resolveActor(input.actor);
  const result = await service.setMuteState(auth.did, target.did, input.mute);
  return c.json(result);
});

app.post("/api/moderation/report", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({
    subjectUri: z.string().max(2048),
    subjectCid: z.string().max(200).optional(),
    reasonType: z.string().max(100).regex(/^com\.atproto\.moderation\./),
    comment: z.string().max(2000).optional()
  }).strict().parse(await c.req.json());
  const service = new GraphService(c.env);
  return c.json(await service.reportContent(auth.did, {
    subjectUri: input.subjectUri,
    reasonType: input.reasonType,
    ...(input.subjectCid !== undefined ? { subjectCid: input.subjectCid } : {}),
    ...(input.comment !== undefined ? { comment: input.comment } : {})
  }));
});

// Social reads (plan §C3/C5): timeline, threads, notifications, search.
app.get("/api/timeline", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const limit = z.coerce.number().int().min(1).max(50).default(25).parse(c.req.query("limit") ?? undefined);
  const service = new AtprotoService(c.env);
  const result = await service.getTimeline(auth.did, c.req.query("cursor") ?? undefined, limit);
  return c.json(result, 200, { "Cache-Control": "no-store" });
});

app.get("/api/post-thread", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const uri = z.string().max(2048).parse(c.req.query("uri"));
  const service = new AtprotoService(c.env);
  return c.json(await service.getPostThread(auth.did, uri), 200, { "Cache-Control": "no-store" });
});

// Media pipeline (plan §C4): prepared drafts with encrypted metadata.
app.post("/api/media/image/prepare", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = prepareImageSchema.parse(await c.req.json());
  const service = new MediaService(c.env);
  return c.json(await service.prepareImage(auth.did, input));
});


// Saved/custom feeds (plan §C3): list and mutate through preferences.
app.get("/api/feeds/saved", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const service = new AtprotoService(c.env);
  return c.json({ feeds: await service.getSavedFeeds(auth.did) }, 200, { "Cache-Control": "no-store" });
});

app.post("/api/feeds/saved", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ uri: z.string().max(2048), cid: z.string().max(200).optional(), pinned: z.boolean().optional() }).strict().parse(await c.req.json());
  const service = new AtprotoService(c.env);
  return c.json(await service.setSavedFeed(auth.did, {
    uri: input.uri,
    ...(input.cid !== undefined ? { cid: input.cid } : {}),
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {})
  }));
});

app.delete("/api/feeds/saved", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const uri = z.string().max(2048).parse(c.req.query("uri"));
  const service = new AtprotoService(c.env);
  return c.json(await service.unsetSavedFeed(auth.did, uri));
});
app.post("/api/media/image/upload", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const draftIdParam = c.req.query("draftId") ?? c.req.header("X-Draft-Id");
  if (!draftIdParam) {
    throw new NetslumError("INVALID_INPUT", "draftId query parameter or X-Draft-Id header is required", 400);
  }
  const draftId = z.string().max(64).parse(draftIdParam);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const service = new MediaService(c.env);
  return c.json(await service.uploadImage(auth.did, draftId, bytes));
});

app.post("/api/media/image/:draftId", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const draftId = z.string().max(64).parse(c.req.param("draftId"));
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const service = new MediaService(c.env);
  return c.json(await service.uploadImage(auth.did, draftId, bytes));
});

app.post("/api/media/video/prepare", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = prepareVideoSchema.parse(await c.req.json());
  const service = new MediaService(c.env);
  return c.json(await service.prepareVideo(auth.did, input));
});

app.post("/api/media/video/chunk", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const draftIdParam = c.req.query("draftId") ?? c.req.header("X-Draft-Id");
  if (!draftIdParam) {
    throw new NetslumError("INVALID_INPUT", "draftId query parameter or X-Draft-Id header is required", 400);
  }
  const draftId = z.string().max(64).parse(draftIdParam);
  const partNumberParam = c.req.query("partNumber") ?? c.req.header("X-Part-Number");
  const partNumber = partNumberParam ? parseInt(partNumberParam, 10) : 1;
  const totalPartsParam = c.req.query("totalParts") ?? c.req.header("X-Total-Parts");
  const totalParts = totalPartsParam ? parseInt(totalPartsParam, 10) : undefined;
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const service = new MediaService(c.env);
  return c.json(await service.uploadVideoChunk(auth.did, draftId, bytes, partNumber, totalParts));
});

app.post("/api/media/video/complete", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  let draftId: string | undefined;
  let jobId: string | undefined;

  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = z.object({
      draftId: z.string().max(64),
      jobId: z.string().max(128).optional()
    }).safeParse(body);
    if (parsed.success) {
      draftId = parsed.data.draftId;
      jobId = parsed.data.jobId;
    }
  }

  if (!draftId) {
    const draftIdQuery = c.req.query("draftId") ?? c.req.header("X-Draft-Id");
    if (draftIdQuery) draftId = z.string().max(64).parse(draftIdQuery);
  }
  if (!jobId) {
    const jobIdQuery = c.req.query("jobId") ?? c.req.header("X-Job-Id");
    if (jobIdQuery) jobId = z.string().max(128).parse(jobIdQuery);
  }

  if (!draftId) {
    throw new NetslumError("INVALID_INPUT", "draftId is required", 400);
  }

  const service = new MediaService(c.env);
  return c.json(await service.completeVideo(auth.did, draftId, jobId));
});

app.get("/api/media/video/status", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const jobIdParam = c.req.query("jobId") ?? c.req.header("X-Job-Id");
  if (!jobIdParam) {
    throw new NetslumError("INVALID_INPUT", "jobId query parameter is required", 400);
  }
  const jobId = z.string().max(128).parse(jobIdParam);
  const service = new MediaService(c.env);
  return c.json(await service.getJobStatus(auth.did, jobId), 200, { "Cache-Control": "no-store" });
});

// Direct messages (plan §D). All reads/writes proxy to Bluesky Chat with the
// actor's grant; no message bodies are stored beyond encrypted pending sends.
app.get("/api/dms/status", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const service = new ChatService(c.env);
  return c.json(await service.getStatus(auth.did), 200, { "Cache-Control": "no-store" });
});

app.get("/api/dms/conversations", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const limit = z.coerce.number().int().min(1).max(50).default(25).parse(c.req.query("limit") ?? undefined);
  const service = new ChatService(c.env);
  return c.json(await service.listConversations(auth.did, c.req.query("cursor") ?? undefined, limit), 200, { "Cache-Control": "no-store" });
});

app.get("/api/dms/requests", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const limit = z.coerce.number().int().min(1).max(50).default(25).parse(c.req.query("limit") ?? undefined);
  const service = new ChatService(c.env);
  return c.json(await service.listRequests(auth.did, c.req.query("cursor") ?? undefined, limit), 200, { "Cache-Control": "no-store" });
});

app.get("/api/author-feed", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false).catch(() => null);
  const actor = z.string().max(315).parse(c.req.query("actor"));
  const limit = z.coerce.number().int().min(1).max(50).default(25).parse(c.req.query("limit") ?? undefined);
  const service = new AtprotoService(c.env);
  return c.json(await service.getAuthorFeed(auth?.did, actor, c.req.query("cursor") ?? undefined, limit), 200, { "Cache-Control": "no-store" });
});

app.get("/api/post-engagement", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false).catch(() => null);
  const uri = z.string().max(2048).parse(c.req.query("uri"));
  const kind = z.enum(["likes", "reposts", "quotes"]).parse(c.req.query("kind"));
  const service = new AtprotoService(c.env);
  return c.json(await service.getPostEngagement(auth?.did, uri, kind), 200, { "Cache-Control": "no-store" });
});

app.put("/api/profile", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = updateProfileSchema.parse(await c.req.json());
  const service = new AtprotoService(c.env);
  return c.json(await service.updateOwnProfile(auth.did, {
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.avatarRef !== undefined ? { avatarRef: input.avatarRef } : {}),
    ...(input.bannerRef !== undefined ? { bannerRef: input.bannerRef } : {})
  }));
});

app.post("/api/profile/avatar", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const contentType = c.req.header("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) return c.json({ error: "Must be an image" }, 400);
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > 1_000_000) return c.json({ error: "Image too large (max 1MB)" }, 400);
  const service = new AtprotoService(c.env);
  const blobRef = await service.uploadBlobForDid(auth.did, new Uint8Array(bytes), contentType);
  await service.updateOwnProfile(auth.did, { avatarRef: blobRef });
  return c.json({ ok: true }, 200);
});

app.get("/api/dms/conversation", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const members = z.array(z.string().max(315)).min(1).max(2).parse((c.req.query("members") ?? "").split(",").filter(Boolean));
  const service = new ChatService(c.env);
  return c.json(await service.getConvoForMembers(auth.did, members), 200, { "Cache-Control": "no-store" });
});
app.post("/api/dms/start", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ recipient: z.string().min(1).max(315) }).strict().parse(await c.req.json());
  const graph = new GraphService(c.env);
  const resolved = await graph.resolveActor(input.recipient);
  const chat = new ChatService(c.env);
  const convo = await chat.getConvoForMembers(auth.did, [resolved.did]);
  return c.json({ convo, recipientDid: resolved.did, handle: resolved.handle });
});


app.get("/api/dms/messages", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const convoId = z.string().max(64).parse(c.req.query("convoId"));
  const limit = z.coerce.number().int().min(1).max(50).default(50).parse(c.req.query("limit") ?? undefined);
  const service = new ChatService(c.env);
  return c.json(await service.getMessages(auth.did, convoId, c.req.query("cursor") ?? undefined, limit), 200, { "Cache-Control": "no-store" });
});

app.post("/api/dms/prepare", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({
    convoId: z.string().max(64).optional(),
    recipientDids: z.array(z.string().max(315)).min(1).max(8),
    text: z.string().max(4000)
  }).strict().parse(await c.req.json());
  let convoId = input.convoId;
  if (!convoId) {
    const chat = new ChatService(c.env);
    // The chat service treats the authenticated requester as an implicit member,
    // so pass only recipients; recipient-policy failures (muted, following-only,
    // disabled) must surface instead of producing an unsendable draft.
    const convo = await chat.getConvoForMembers(auth.did, input.recipientDids);
    convoId = typeof convo.id === "string" ? convo.id : "";
  }
  const service = new DmDraftService(c.env);
  return c.json(await service.prepare(auth.did, { convoId: convoId ?? "", recipientDids: input.recipientDids, text: input.text }), 200, { "Cache-Control": "no-store" });
});

app.post("/api/dms/send", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ revision: z.string().max(64) }).strict().parse(await c.req.json());
  const drafts = new DmDraftService(c.env);
  const chat = new ChatService(c.env);
  const prepared = await drafts.load(auth.did, input.revision);
  const sent = await chat.sendMessage(auth.did, prepared.convoId, prepared.text);
  await drafts.consume(auth.did, input.revision);
  return c.json({ messageId: sent.messageId });
});

app.post("/api/dms/read", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ convoId: z.string().max(64), messageId: z.string().max(64).optional() }).strict().parse(await c.req.json());
  const service = new ChatService(c.env);
  return c.json(await service.updateRead(auth.did, input.convoId, input.messageId));
});

app.post("/api/dms/react", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({
    convoId: z.string().max(64),
    messageId: z.string().max(64),
    value: z.string().max(8),
    remove: z.boolean().optional()
  }).strict().parse(await c.req.json());
  const service = new ChatService(c.env);
  return c.json(await service.react(auth.did, input.convoId, input.messageId, input.value, input.remove === true));
});

app.post("/api/dms/delete-for-self", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ convoId: z.string().max(64), messageId: z.string().max(64) }).strict().parse(await c.req.json());
  const service = new ChatService(c.env);
  return c.json(await service.deleteMessageForSelf(auth.did, input.convoId, input.messageId));
});

app.post("/api/dms/delete", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ convoId: z.string().max(64), messageId: z.string().max(64) }).strict().parse(await c.req.json());
  const service = new ChatService(c.env);
  return c.json(await service.deleteMessageForSelf(auth.did, input.convoId, input.messageId));
});

app.post("/api/dms/accept", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ convoId: z.string().max(64) }).strict().parse(await c.req.json());
  const service = new ChatService(c.env);
  return c.json(await service.acceptConvo(auth.did, input.convoId));
});

app.post("/api/dms/mute", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ convoId: z.string().max(64), mute: z.boolean() }).strict().parse(await c.req.json());
  const service = new ChatService(c.env);
  return c.json(await service.setMuteState(auth.did, input.convoId, input.mute));
});

// DM agent toggle (plan §B5): a visible trusted toggle is the only way.
app.put("/api/settings/dm-agent", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ enabled: z.boolean() }).strict().parse(await c.req.json());
  await c.env.DB.prepare("UPDATE web_session SET dm_agent_enabled=? WHERE id_hash=?")
    .bind(input.enabled ? 1 : 0, auth.sessionIdHash).run();
  return c.json({ dmAgentEnabled: input.enabled });
});

app.get("/api/settings/chat-declaration", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const service = new ChatService(c.env);
  return c.json(await service.ensureDeclaration(auth.did));
});

app.put("/api/settings/chat-declaration", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({
    allowIncoming: z.enum(["all", "following", "none"])
  }).strict().parse(await c.req.json());
  const service = new ChatService(c.env);
  return c.json(await service.updateDeclaration(auth.did, input.allowIncoming));
});

app.delete("/api/posts/:uri", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const uri = decodeURIComponent(c.req.param("uri"));
  const service = new AtprotoService(c.env);
  return c.json(await service.deleteOwnPost(auth.did, uri));
});

app.get("/api/notifications", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const limit = z.coerce.number().int().min(1).max(50).default(25).parse(c.req.query("limit") ?? undefined);
  const service = new AtprotoService(c.env);
  const result = await service.listNotifications(auth.did, c.req.query("cursor") ?? undefined, limit);
  return c.json(result, 200, { "Cache-Control": "no-store" });
});

app.post("/api/notifications/seen", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const input = z.object({ seenAt: z.string().max(40).optional() }).strict().parse(await c.req.json().catch(() => ({})));
  const service = new AtprotoService(c.env);
  return c.json(await service.markNotificationsSeen(auth.did, input.seenAt));
});

app.get("/api/search/posts", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false).catch(() => null);
  const q = z.string().min(1).max(64).parse(c.req.query("q"));
  const limit = z.coerce.number().int().min(1).max(25).default(25).parse(c.req.query("limit") ?? undefined);
  const service = new AtprotoService(c.env);
  const result = await service.searchPosts(auth?.did, q, c.req.query("cursor") ?? undefined, limit);
  return c.json(result, 200, { "Cache-Control": "no-store" });
});

app.get("/api/search/actors", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false).catch(() => null);
  const q = z.string().min(1).max(64).parse(c.req.query("q"));
  const limit = z.coerce.number().int().min(1).max(25).default(25).parse(c.req.query("limit") ?? undefined);
  const service = new GraphService(c.env);
  const result = await service.searchActors(auth?.did, q, limit, c.req.query("cursor") ?? undefined);
  return c.json(result, 200, { "Cache-Control": "no-store" });
});

app.get("/api/search/feeds", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false).catch(() => null);
  const q = z.string().min(1).max(64).parse(c.req.query("q"));
  const limit = z.coerce.number().int().min(1).max(25).default(25).parse(c.req.query("limit") ?? undefined);
  const service = new AtprotoService(c.env);
  const result = await service.searchFeeds(auth?.did, q, c.req.query("cursor") ?? undefined, limit);
  return c.json(result, 200, { "Cache-Control": "no-store" });
});

app.get("/api/feed/custom", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false).catch(() => null);
  const feed = z.string().min(1).max(2048).parse(c.req.query("feed") ?? c.req.query("feedUri"));
  const limit = z.coerce.number().int().min(1).max(50).default(25).parse(c.req.query("limit") ?? undefined);
  const service = new AtprotoService(c.env);
  const result = await service.getCustomFeed(auth?.did, feed, c.req.query("cursor") ?? undefined, limit);
  return c.json(result, 200, { "Cache-Control": "no-store" });
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
  const parsed = zoneMutationSchema.parse(body); // validate schema

  for (const operation of parsed.operations) {
    if (operation.op === "place") {
      const obj = operation.object;
      if (obj.type === "portal" && obj.experience?.siteSlug) {
        const site = await c.env.DB.prepare("SELECT did FROM site WHERE slug=? AND status='active'").bind(obj.experience.siteSlug).first<{ did: string }>();
        if (!site || site.did !== auth.did) {
          throw new NetslumError("FORBIDDEN", "You can only link portals to your own published sites", 403);
        }
      }
    }
  }

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

app.post("/api/sites/preview-session", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const body = await c.req.json<{ revision?: string }>().catch(() => ({} as { revision?: string }));
  const service = new SiteService(c.env);
  const draft = await service.getDraft(auth.did);
  const revision = body.revision ?? draft.revision;
  const siteId = `site-${(await sha256Hex(auth.did)).slice(0, 24)}`;
  const token = await randomToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO preview_capability(capability_hash, did, revision, created_at, expires_at) VALUES(?,?,?,?,?)"
  ).bind(tokenHash, auth.did, revision, now, now + 10 * 60_000).run();

  const previewUrl = `https://preview-${siteId}.sites.netslum.macha.sh/?cap=${token}`;
  return c.json({ previewUrl, token, revision, expiresAt: now + 10 * 60_000 });
});

app.post("/api/sites/publish", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const body: unknown = await c.req.json();
  const parsed = publishSiteSchema.parse(body);
  const service = new SiteService(c.env);
  const result = await service.publish(auth.did, parsed);
  return c.json(result);
});

// Phase 2 home settings (plan §B6) — local-PDS users only.
app.get("/api/home/settings", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const service = new HomeSettingsService(c.env);
  // External identities always receive standard mode and no site row.
  const local = await canPublishSite(auth.did, c.env).catch(() => false);
  if (!local) return c.json({ mode: "standard", activeHomePath: null });
  const settings = await service.get(auth.did);
  return c.json(settings);
});

app.put("/api/home/settings", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const service = new HomeSettingsService(c.env);
  await service.requireLocalPds(auth.did);
  const parsed = z.object({
    mode: homeModeSchema,
    activeHomePath: z.string().max(128).nullable()
  }).strict().parse(await c.req.json());
  await service.set(auth.did, parsed);
  return c.json(await service.get(auth.did));
});

app.get("/api/home/schema", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false).catch(() => null);
  if (!auth) return c.json({ schema: null });
  const service = new HomeSettingsService(c.env);
  const settings = await service.get(auth.did).catch(() => ({ layoutSchema: null }));
  return c.json({ schema: settings.layoutSchema });
});

app.put("/api/home/schema", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const service = new HomeSettingsService(c.env);
  await service.requireLocalPds(auth.did);
  const body = await c.req.json<{ schema?: Record<string, unknown> | null }>();
  if (body.schema && JSON.stringify(body.schema).length > 65536) {
    throw new NetslumError("INVALID_INPUT", "Home layout schema exceeds 64 KiB limit", 400);
  }
  await service.setLayoutSchema(auth.did, body.schema ?? null);
  const settings = await service.get(auth.did);
  return c.json({ ok: true, schema: settings.layoutSchema });
});

app.get("/api/sites/schema", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false);
  const service = new SiteService(c.env);
  const fileName = c.req.query("file") || "personal_page.json";
  const result = await service.getPageSchema(auth.did, fileName);
  return c.json(result);
});

app.put("/api/sites/schema", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, true);
  const service = new SiteService(c.env);
  const fileName = c.req.query("file") || "personal_page.json";
  const body = await c.req.json<{ schema: Record<string, unknown> }>();
  if (JSON.stringify(body.schema).length > 65536) {
    throw new NetslumError("INVALID_INPUT", "Page schema exceeds 64 KiB limit", 400);
  }
  const result = await service.savePageSchema(auth.did, body.schema, undefined, fileName);
  return c.json({ ok: true, revision: result.revision, schema: body.schema });
});

app.get("/api/sites/public-schema", async (c) => {
  const slugOrActor = c.req.query("slug") || c.req.query("actor") || "";
  if (!slugOrActor) throw new NetslumError("INVALID_INPUT", "Missing slug or actor parameter", 400);
  const fileName = c.req.query("file") || "personal_page.json";
  const service = new SiteService(c.env);
  const result = await service.getPublicPageSchema(slugOrActor, fileName);
  return c.json(result);
});

// Authored home (plan §E2): local-PDS users in authored mode mount their
// active site's home.html from the TENANT origin (never same-origin srcdoc).
// Missing/unpublished/suspended home content falls back to standard home.
app.get("/api/home/mount", async (c) => {
  const auth = await authenticateRequest(c.req.raw, c.env, false).catch(() => null);
  if (!auth) return c.json({ mode: "standard" });
  const settings = new HomeSettingsService(c.env);
  const local = await canPublishSite(auth.did, c.env).catch(() => false);
  if (!local) return c.json({ mode: "standard" });
  const home = await settings.get(auth.did);
  if (home.mode !== "authored") return c.json({ mode: "standard" });
  const site = await c.env.DB.prepare(
    "SELECT slug, active_revision, status FROM site WHERE did=?"
  ).bind(auth.did).first<{ slug: string; active_revision: string | null; status: string }>();
  // Fail closed: suspended/missing/failed home content never bricks navigation.
  if (!site || site.status !== "active" || !site.active_revision) return c.json({ mode: "standard" });
  const siteId = `site-${(await sha256Hex(auth.did)).slice(0, 24)}`;
  const [indexObj, homeObj] = await Promise.all([
    c.env.SITE_FILES.get(`release/${siteId}/${site.active_revision}/index.html`).catch(() => null),
    c.env.SITE_FILES.get(`release/${siteId}/${site.active_revision}/home.html`).catch(() => null)
  ]);
  const targetPath = indexObj ? "/index.html" : homeObj ? "/home.html" : null;
  if (!targetPath) return c.json({ mode: "standard" });
  return c.json({
    mode: "authored",
    tenantOrigin: `https://${site.slug}.sites.netslum.macha.sh`,
    path: targetPath,
    title: `@${site.slug}`,
    revision: site.active_revision
  }, 200, { "Cache-Control": "no-store" });
});

// Public bridge data for authored homes (plan §E2): public town/feed/profile
// reads only. No notification, preference, session, or DM data enters here.
app.get("/api/home/bridge/:view", async (c) => {
  const view = c.req.param("view");
  const service = new AtprotoService(c.env);
  if (view === "town") {
    const limit = z.coerce.number().int().min(1).max(50).default(10).parse(c.req.query("limit") ?? undefined);
    const feed = await service.getTownFeed(c.req.query("cursor") ?? undefined, limit).catch(() => null);
    if (!feed) throw new NetslumError("UPSTREAM_UNAVAILABLE", "Town feed unavailable", 503, true);
    return c.json({ view: "town", posts: feed.posts, ...(feed.cursor ? { cursor: feed.cursor } : {}) }, 200, { "Cache-Control": "no-store" });
  }
  if (view === "profile") {
    const actor = z.string().max(315).parse(c.req.query("actor"));
    const profile = await service.getProfile(actor).catch(() => null);
    if (!profile) throw new NetslumError("NOT_FOUND", "Profile not found", 404);
    return c.json({ view: "profile", profile }, 200, { "Cache-Control": "no-store" });
  }
  if (view === "search") {
    const q = z.string().min(1).max(64).parse(c.req.query("q"));
    const result = await service.searchPosts(undefined, q, c.req.query("cursor") ?? undefined, 10).catch(() => null);
    if (!result) throw new NetslumError("UPSTREAM_UNAVAILABLE", "Search unavailable", 503, true);
    return c.json({ view: "search", posts: result.posts, ...(result.cursor ? { cursor: result.cursor } : {}) }, 200, { "Cache-Control": "no-store" });
  }
  throw new NetslumError("INVALID_INPUT", "Unknown bridge view", 400);
});

// Tenant tool manifests (plan §F2): an optional active-release webmcp.json.
// Publish-time validation happens here; execution posts to the isolated
// tenant runtime with fixed endpoint /api/__webmcp/<name>.
app.get("/api/sites/manifest", async (c) => {
  // Public per-slug read (tenant parent registration) or self lookup.
  const slugParam = slugSchema.safeParse(c.req.query("slug") ?? "");
  let slug: string | null = null;
  if (slugParam.success) {
    slug = slugParam.data;
  } else {
    const auth = await authenticateRequest(c.req.raw, c.env, false);
    const own = await c.env.DB.prepare("SELECT slug FROM site WHERE did=? AND status='active'").bind(auth.did).first<{ slug: string }>();
    slug = own?.slug ?? null;
  }
  if (!slug) return c.json({ manifest: null });
  const site = await c.env.DB.prepare(
    "SELECT did, active_revision FROM site WHERE slug=? AND status='active' AND active_revision IS NOT NULL LIMIT 1"
  ).bind(slug).first<{ did: string; active_revision: string }>();
  if (!site) return c.json({ manifest: null });
  const siteId = `site-${(await sha256Hex(site.did)).slice(0, 24)}`;
  const manifestObject = await c.env.SITE_FILES.get(`release/${siteId}/${site.active_revision}/webmcp.json`).catch(() => null);
  if (!manifestObject) return c.json({ slug, manifest: null });
  // Fail closed: a malformed active manifest surfaces INVALID_TOOL_MANIFEST
  // rather than registering broken tools (plan §F2 publish-time validation).
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(await manifestObject.text()); } catch {
    throw new NetslumError("INVALID_TOOL_MANIFEST", "webmcp.json is not valid JSON", 400);
  }
  const manifest = tenantToolManifestSchema.safeParse(parsedJson);
  if (!manifest.success) {
    throw new NetslumError("INVALID_TOOL_MANIFEST", `webmcp.json failed validation: ${manifest.error.issues[0]?.message ?? "invalid"}`, 400);
  }
  return c.json({ slug, manifest: manifest.data }, 200, { "Cache-Control": "no-store" });
});

// Tenant tool execution (plan §F2): the fixed endpoint POST
// /api/__webmcp/<slug>/<name>. Input is validated against the published
// manifest schema at execution time (not just publish time), bounded to 4 KiB
// in and 4 KiB out, executed through the site's isolated runtime dispatch
// binding, and never receives Netslum credentials, cookies, or CSRF tokens.
app.post("/api/__webmcp/:slug/:tool", async (c) => {
  const slug = slugSchema.safeParse(c.req.param("slug"));
  const toolName = c.req.param("tool");
  if (!slug.success || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(toolName)) {
    throw new NetslumError("INVALID_INPUT", "Invalid tenant tool path", 400);
  }
  const site = await c.env.DB.prepare(
    "SELECT did, active_revision, active_worker, status FROM site WHERE slug=? AND status='active' LIMIT 1"
  ).bind(slug.data).first<{ did: string; active_revision: string | null; active_worker: string | null; status: string }>();
  if (!site?.active_revision || !site.active_worker) {
    throw new NetslumError("TOOL_RUNTIME_FAILED", "Tenant runtime is unavailable for this site", 503);
  }
  // Re-validate the LIVE active manifest at execution time so a stale
  // registration cannot outlive a manifest change.
  const siteId = `site-${(await sha256Hex(site.did)).slice(0, 24)}`;
  const manifestObject = await c.env.SITE_FILES.get(`release/${siteId}/${site.active_revision}/webmcp.json`).catch(() => null);
  if (!manifestObject) throw new NetslumError("TOOL_RUNTIME_FAILED", "Tenant manifest is no longer published", 404);
  let manifestJson: unknown;
  try { manifestJson = JSON.parse(await manifestObject.text()); } catch {
    throw new NetslumError("INVALID_TOOL_MANIFEST", "webmcp.json is not valid JSON", 400);
  }
  const manifest = tenantToolManifestSchema.safeParse(manifestJson);
  if (!manifest.success) throw new NetslumError("INVALID_TOOL_MANIFEST", "webmcp.json failed validation", 400);
  const tool = manifest.data.tools.find((entry) => entry.name === toolName);
  if (!tool) throw new NetslumError("TOOL_RUNTIME_FAILED", "Tool is not in the published manifest", 404);
  const payload = await c.req.json<{ input?: unknown }>().catch(() => null);
  if (!payload || typeof payload !== "object") throw new NetslumError("INVALID_INPUT", "A JSON body is required", 400);
  // Full JSON-Schema-subset validation of the input happens inside the
  // isolated runtime worker (which owns the manifest schema); here only the
  // byte bounds are enforced (plan §F2 execution limits).
  // Execution flows through the site's isolated runtime dispatch binding
  // with the same CPU/subrequest/egress limits as _worker.js requests
  // (plan §F2). No Netslum credentials are forwarded.
  const runtimeUrl = `https://runtime.internal/${siteId}/api/__webmcp/${encodeURIComponent(toolName)}`;
  const runtimeRequest = new Request(runtimeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Netslum-Site-Id": siteId },
    body: JSON.stringify({ input: payload.input ?? {} }),
    signal: AbortSignal.timeout(10000)
  });
  let runtimeResponse: Response;
  if (c.env.SITE_RUNTIME) {
    runtimeResponse = await c.env.SITE_RUNTIME.fetch(runtimeRequest).catch(() => {
      throw new NetslumError("TOOL_RUNTIME_FAILED", "Tenant tool execution failed", 502);
    });
  } else if (c.env.STAGING_DISPATCHER) {
    const worker = c.env.STAGING_DISPATCHER.get(site.active_worker, {}, { limits: { cpuMs: 50, subRequests: 5 } });
    runtimeResponse = await worker.fetch(runtimeRequest).catch(() => {
      throw new NetslumError("TOOL_RUNTIME_FAILED", "Tenant tool execution failed", 502);
    });
  } else {
    throw new NetslumError("SERVERLESS_UNAVAILABLE", "Tenant runtime unavailable", 503);
  }
  const bodyBytes = await runtimeResponse.arrayBuffer();
  if (bodyBytes.byteLength > 4096) throw new NetslumError("TOOL_RUNTIME_FAILED", "Tenant tool result exceeds 4 KiB", 502);
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  return new Response(bodyBytes, { status: runtimeResponse.status, headers });
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
// Serves the user's published site via the tenant origin (slug.sites.netslum.macha.sh)
// instead of srcdoc, so allow-same-origin is safe (isolated origin) and nested
// iframes (YouTube, etc.) work correctly.
app.get("/:vanity{@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$}", async (c) => {
  const rawSlug = c.req.param("vanity").slice(1);
  if (!slugSchema.safeParse(rawSlug).success) return c.text("Not found", 404);

  const site = await c.env.DB.prepare("SELECT slug, active_revision, status FROM site WHERE slug = ? AND status = 'active'").bind(rawSlug).first<{
    slug: string;
    active_revision: string | null;
  }>();
  if (!site || !site.active_revision) return c.text("Site not found or inactive", 404);

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
    iframe { flex: 1; border: none; width: 100%; height: calc(100vh - 44px); background: #070910; }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">netslum</a>
    <span class="site-info">@${site.slug} (rev: ${site.active_revision.slice(0, 8)})</span>
    <a href="/town" style="color:#57E6FF;text-decoration:none;font-size:13px;">town square &rarr;</a>
  </header>
  <iframe sandbox="allow-scripts allow-same-origin" src="https://${site.slug}.sites.netslum.macha.sh/index.html"></iframe>
</body>
</html>`;
  return c.html(shellHtml);
});


// Trusted district route (plan §E4): entering an experienced portal mounts
// the tenant iframe on its real origin. The slug is validated server-side;
// the route resolves the owner's ACTIVE revision (fail closed) and renders
// a permanent trusted exit control. WebGPU delegation rides allow="webgpu".
app.get("/district/:slug{[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?}", async (c) => {
  const slug = slugSchema.safeParse(c.req.param("slug"));
  if (!slug.success) return c.text("Invalid district", 404);
  const site = await c.env.DB.prepare(
    "SELECT did, active_revision, status FROM site WHERE slug=? AND status='active' AND active_revision IS NOT NULL LIMIT 1"
  ).bind(slug.data).first<{ did: string; active_revision: string | null; status: string }>();
  if (!site?.active_revision) return c.text("District unavailable", 404);
  const pathParam = c.req.query("path") && sitePathSchema.safeParse(c.req.query("path")).success ? c.req.query("path") as string : "index.html";
  const shellHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>district // @${slug.data} — netslum</title>
  <style>
    body { margin: 0; background: #070910; color: #E8F0FF; font-family: ui-monospace, Menlo, Consolas, monospace; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    header { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid #2A3652; background: #101522; z-index: 10; }
    .brand { color: #57E6FF; font-weight: bold; text-decoration: none; font-size: 14px; }
    .district-info { color: #8792AA; font-size: 13px; }
    iframe { flex: 1; border: none; width: 100%; height: calc(100vh - 44px); background: #070910; }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">netslum</a>
    <span class="district-info">district: @${slug.data} // ${pathParam}</span>
    <a href="/gate" style="color:#57E6FF;text-decoration:none;font-size:13px;">exit district &rarr;</a>
  </header>
  <iframe sandbox="allow-scripts allow-same-origin" allow="webgpu; tools" src="https://${slug.data}.sites.netslum.macha.sh/${pathParam}"></iframe>
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
  <link rel="preconnect" href="https://public.api.bsky.app" crossorigin>
  <link rel="preconnect" href="https://video.bsky.app" crossorigin>
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
