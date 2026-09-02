import { Agent, RichText } from "@atproto/api";
import {
  deterministicPostRkey,
  deterministicReactionRkey,
  NetslumError,
  sha256Hex,
  type PostSummary
} from "@netslum/contracts";
import { z } from "zod";
import { getOAuthClient } from "../auth/oauth.js";
import { MediaService } from "../media/MediaService.js";
import type { CloudflareEnv } from "../../types.js";

const postRecordSchema = z.object({ text: z.string().optional(), createdAt: z.string().optional() });
const replyRecordSchema = z.object({ reply: z.object({ root: z.object({ uri: z.string(), cid: z.string() }).optional() }).optional() });
const subjectRecordSchema = z.object({ subject: z.object({ uri: z.string().optional() }).optional() });

interface FeedCacheRow { response_json: string; fetched_at: number; expires_at: number; }
interface DraftRow { draft_id: string; revision: string; text: string; reply_to_uri: string | null; }
interface OptimisticPostRow { post_json: string; }

const optimisticPostSchema = z.object({
  uri: z.string(),
  cid: z.string(),
  author: z.object({
    did: z.string(),
    handle: z.string(),
    displayName: z.string().optional()
  }),
  text: z.string(),
  createdAt: z.string()
});

const localReposSchema = z.object({
  repos: z.array(z.object({
    did: z.string(),
    active: z.boolean().optional()
  }))
});

const localRecordsSchema = z.object({
  records: z.array(z.object({
    uri: z.string(),
    cid: z.string(),
    value: z.unknown()
  }))
});

export function mergeTownPosts(
  optimistic: PostSummary[],
  authoritative: PostSummary[],
  limit: number
): PostSummary[] {
  const posts = new Map<string, PostSummary>();
  for (const post of optimistic) posts.set(post.uri, post);
  for (const post of authoritative) posts.set(post.uri, post);
  return [...posts.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

function didDocumentUrl(did: string): string | null {
  if (did.startsWith("did:plc:")) return `https://plc.directory/${encodeURIComponent(did)}`;
  if (!did.startsWith("did:web:")) return null;
  const parts = did.slice("did:web:".length).split(":").map(decodeURIComponent);
  const host = parts.shift();
  if (!host) return null;
  return parts.length === 0
    ? `https://${host}/.well-known/did.json`
    : `https://${host}/${parts.join("/")}/did.json`;
}

function graphemeLength(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
}

export class AtprotoService {
  constructor(private readonly env: CloudflareEnv) {}

  private async getAgent(actorDid?: string): Promise<Agent> {
    if (!actorDid) return new Agent(this.env.BSKY_PUBLIC_API);
    const client = await getOAuthClient(this.env);
    const session = await client.restore(actorDid).catch(() => undefined);
    if (!session) throw new NetslumError("AUTH_REQUIRED", "Please sign in again", 401);
    return new Agent(session);
  }

  private async getOptimisticPosts(cursor: string | undefined, limit: number, now: number): Promise<PostSummary[]> {
    if (cursor) return [];
    const rows = await this.env.DB.prepare(
      "SELECT post_json FROM optimistic_post WHERE expires_at > ? ORDER BY expires_at DESC LIMIT ?"
    ).bind(now, limit).all<OptimisticPostRow>();
    const posts: PostSummary[] = [];
    for (const row of rows.results) {
      try {
        const parsed = optimisticPostSchema.safeParse(JSON.parse(row.post_json));
        if (!parsed.success) continue;
        const author: PostSummary["author"] = {
          did: parsed.data.author.did,
          handle: parsed.data.author.handle
        };
        if (parsed.data.author.displayName) author.displayName = parsed.data.author.displayName;
        posts.push({ ...parsed.data, author });
      } catch {
        // Ignore malformed short-lived projection rows; AT repositories remain authoritative.
      }
    }
    return posts;
  }

  private async resolveActorHandle(actorDid: string): Promise<string> {
    const url = didDocumentUrl(actorDid);
    if (!url) return actorDid;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return actorDid;
      const document = z.object({ alsoKnownAs: z.array(z.string()).optional() }).parse(await response.json());
      const alias = document.alsoKnownAs?.find((value) => value.startsWith("at://"));
      return alias ? alias.slice("at://".length) : actorDid;
    } catch {
      return actorDid;
    }
  }

  private async getLocalPdsPosts(cursor: string | undefined, limit: number): Promise<PostSummary[]> {
    if (cursor) return [];
    const pdsUrl = this.env.PDS_URL.replace(/\/$/, "");
    const reposResponse = await fetch(
      `${pdsUrl}/xrpc/com.atproto.sync.listRepos?limit=25`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!reposResponse.ok) return [];
    const repos = localReposSchema.parse(await reposResponse.json()).repos
      .filter((repo) => repo.active !== false)
      .slice(0, 25);
    const handles = new Map<string, string>();

    const pages = await Promise.all(repos.map(async ({ did }) => {
      try {
        const response = await fetch(
          `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=app.bsky.feed.post&limit=20&reverse=true`,
          { signal: AbortSignal.timeout(4000) }
        );
        if (!response.ok) return [];
        const records = localRecordsSchema.parse(await response.json()).records;
        let handle = handles.get(did);
        if (!handle) {
          handle = await this.resolveActorHandle(did);
          handles.set(did, handle);
        }
        return records.flatMap((record): PostSummary[] => {
          const value = postRecordSchema.safeParse(record.value);
          if (!value.success || !value.data.text || !/(^|\s)#netslum(?:\s|$)/i.test(value.data.text)) return [];
          return [{
            uri: record.uri,
            cid: record.cid,
            author: { did, handle },
            text: value.data.text,
            createdAt: value.data.createdAt ?? new Date(0).toISOString()
          }];
        });
      } catch {
        return [];
      }
    }));

    return pages.flat()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  private async finalizePublishedPost(
    actorDid: string,
    draftRevision: string,
    uri: string,
    cid: string,
    text: string,
    publishedAt: string
  ): Promise<void> {
    const handle = await this.resolveActorHandle(actorDid);
    const optimistic: PostSummary = {
      uri,
      cid,
      author: { did: actorDid, handle },
      text,
      createdAt: publishedAt
    };
    await this.env.DB.batch([
      this.env.DB.prepare("DELETE FROM post_draft WHERE did=? AND revision=?").bind(actorDid, draftRevision),
      this.env.DB.prepare(
        "INSERT INTO published_post(draft_revision,uri,cid,published_at,created_at) VALUES(?,?,?,?,?) " +
        "ON CONFLICT(draft_revision) DO UPDATE SET uri=excluded.uri,cid=excluded.cid,published_at=excluded.published_at"
      ).bind(draftRevision, uri, cid, publishedAt, Date.now()),
      this.env.DB.prepare(
        "INSERT INTO optimistic_post(draft_revision,uri,did,cid,post_json,expires_at) VALUES(?,?,?,?,?,?) " +
        "ON CONFLICT(draft_revision) DO UPDATE SET uri=excluded.uri,did=excluded.did,cid=excluded.cid,post_json=excluded.post_json,expires_at=excluded.expires_at"
      ).bind(draftRevision, uri, actorDid, cid, JSON.stringify(optimistic), Date.now() + 15 * 60_000),
      this.env.DB.prepare("DELETE FROM feed_cache WHERE cache_key LIKE 'town:%'")
    ]);
  }

  async getTownFeed(cursor?: string, limit = 5): Promise<{ posts: PostSummary[]; cursor?: string; stale: boolean }> {
    const cacheKey = `town:${cursor ?? "first"}:${limit}`;
    const cached = await this.env.DB.prepare(
      "SELECT response_json,fetched_at,expires_at FROM feed_cache WHERE cache_key=?"
    ).bind(cacheKey).first<FeedCacheRow>();
    const now = Date.now();
    const optimistic = await this.getOptimisticPosts(cursor, limit, now);
    const local = await this.getLocalPdsPosts(cursor, limit).catch(() => []);
    const immediate = [...optimistic, ...local];

    if (cached && cached.expires_at > now) {
      const parsed = JSON.parse(cached.response_json) as { posts: PostSummary[]; cursor?: string };
      return {
        posts: mergeTownPosts(immediate, parsed.posts, limit),
        ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
        stale: false
      };
    }

    try {
      const agent = await this.getAgent();
      const qParams: { q: string; sort: "latest"; limit: number; cursor?: string } = {
        q: "#netslum",
        sort: "latest",
        limit
      };
      if (cursor) qParams.cursor = cursor;
      const response = await agent.app.bsky.feed.searchPosts(qParams, { signal: AbortSignal.timeout(5000) });
      const authoritative: PostSummary[] = response.data.posts.map((post) => {
        const record = postRecordSchema.safeParse(post.record).data;
        const author: { did: string; handle: string; displayName?: string } = {
          did: post.author.did,
          handle: post.author.handle
        };
        if (post.author.displayName) author.displayName = post.author.displayName;
        return {
          uri: post.uri,
          cid: post.cid,
          author,
          text: record?.text ?? "",
          createdAt: record?.createdAt ?? new Date().toISOString()
        };
      });
      const payload = JSON.stringify({ posts: authoritative, cursor: response.data.cursor });
      await this.env.DB.prepare(
        "INSERT INTO feed_cache(cache_key,response_json,fetched_at,expires_at) VALUES(?,?,?,?) " +
        "ON CONFLICT(cache_key) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at"
      ).bind(cacheKey, payload, now, now + 30_000).run();
      return {
        posts: mergeTownPosts(immediate, authoritative, limit),
        ...(response.data.cursor ? { cursor: response.data.cursor } : {}),
        stale: false
      };
    } catch {
      if (cached && cached.fetched_at + 15 * 60_000 > now) {
        const parsed = JSON.parse(cached.response_json) as { posts: PostSummary[]; cursor?: string };
        return {
          posts: mergeTownPosts(immediate, parsed.posts, limit),
          ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
          stale: true
        };
      }
      if (immediate.length > 0) return { posts: mergeTownPosts(immediate, [], limit), stale: true };
      throw new NetslumError("UPSTREAM_UNAVAILABLE", "Public feed is temporarily unavailable", 503, true);
    }
  }


  async getProfile(actor: string): Promise<{ did: string; handle: string; displayName?: string; description?: string }> {
    const agent = await this.getAgent();
    const response = await agent.getProfile({ actor }, { signal: AbortSignal.timeout(5000) }).catch(() => {
      throw new NetslumError("NOT_FOUND", "Profile not found", 404);
    });
    const profile: { did: string; handle: string; displayName?: string; description?: string } = {
      did: response.data.did,
      handle: response.data.handle
    };
    if (response.data.displayName) profile.displayName = response.data.displayName;
    if (response.data.description) profile.description = response.data.description;
    return profile;
  }

  async preparePost(
    actorDid: string,
    input: {
      text: string;
      replyToUri?: string;
      expectedRevision: string | null;
      destination?: "town" | "bluesky";
      quoteUri?: string;
      quoteCid?: string;
      languages?: string[];
      mediaDraftIds?: string[];
    }
  ): Promise<{ draftRevision: string; graphemes: number; bytes: number }> {
    // Plan §C3: 'town' appends exactly one #netslum suffix at publish time;
    // 'bluesky' posts never carry the suffix. Destination is stored so publish
    // is a pure function of the draft revision.
    const destination = input.destination === "bluesky" ? "bluesky" : "town";
    const normalized = input.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const fullText = destination === "town" ? `${normalized}\n\n#netslum` : normalized;
    const graphemes = graphemeLength(fullText);
    const bytes = new TextEncoder().encode(fullText).byteLength;
    if (graphemes > 300 || bytes > 3000) throw new NetslumError("INVALID_INPUT", "Post exceeds AT Protocol limits", 400);
    if (input.mediaDraftIds && input.mediaDraftIds.length > 4) throw new NetslumError("INVALID_INPUT", "At most 4 media attachments", 400);
    if (input.quoteUri && !input.quoteCid) throw new NetslumError("INVALID_INPUT", "A quote requires its CID", 400);
    const existing = await this.env.DB.prepare("SELECT draft_id,revision FROM post_draft WHERE did=?").bind(actorDid).first<DraftRow>();
    const extra1: { currentRevision?: string } = {};
    if (existing) extra1.currentRevision = existing.revision;
    if (input.expectedRevision === null && existing) throw new NetslumError("STALE_REVISION", "Draft revision mismatch", 409, false, extra1);
    const extra2: { currentRevision?: string } = {};
    if (existing?.revision) extra2.currentRevision = existing.revision;
    if (input.expectedRevision !== null && (!existing || existing.revision !== input.expectedRevision)) throw new NetslumError("STALE_REVISION", "Draft revision mismatch", 409, false, extra2);
    const draftId = existing?.draft_id ?? crypto.randomUUID();
    const draftRevision = await sha256Hex(JSON.stringify({
      draftId, did: actorDid, text: fullText, replyToUri: input.replyToUri ?? null,
      destination, quoteUri: input.quoteUri ?? null, quoteCid: input.quoteCid ?? null,
      languages: input.languages ?? [], mediaDraftIds: input.mediaDraftIds ?? []
    }));
    await this.env.DB.prepare(
      "INSERT INTO post_draft(did,draft_id,revision,text,reply_to_uri,destination,quote_uri,quote_cid,languages,media_draft_ids,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(did) DO UPDATE SET revision=excluded.revision,text=excluded.text,reply_to_uri=excluded.reply_to_uri,destination=excluded.destination,quote_uri=excluded.quote_uri,quote_cid=excluded.quote_cid,languages=excluded.languages,media_draft_ids=excluded.media_draft_ids,updated_at=excluded.updated_at"
    ).bind(
      actorDid, draftId, draftRevision, fullText, input.replyToUri ?? null, destination,
      input.quoteUri ?? null, input.quoteCid ?? null,
      input.languages ? JSON.stringify(input.languages) : null,
      input.mediaDraftIds ? JSON.stringify(input.mediaDraftIds) : null,
      Date.now()
    ).run();
    return { draftRevision, graphemes, bytes };
  }

  async publishPreparedPost(actorDid: string, draftRevision: string): Promise<{ uri: string; cid: string; publishedAt: string }> {
    const agent = await this.getAgent(actorDid);

    // 1. Retry idempotency: a prior publish of this revision is recorded in
    // the durable mapping (PDS-assigned TID rkeys are not reproducible).
    const prior = await this.env.DB.prepare(
      "SELECT uri,cid FROM published_post WHERE draft_revision=?"
    ).bind(draftRevision).first<{ uri: string; cid: string }>();
    if (prior) {
      const rkey = prior.uri.split("/").pop() ?? "";
      const existing = await agent.com.atproto.repo.getRecord({
        repo: actorDid,
        collection: "app.bsky.feed.post",
        rkey
      }).catch(() => undefined);
      const record = existing ? postRecordSchema.safeParse(existing.data.value).data : undefined;
      const publishedAt = record?.createdAt ?? new Date().toISOString();
      await this.finalizePublishedPost(actorDid, draftRevision, prior.uri, prior.cid, record?.text ?? "", publishedAt);
      return { uri: prior.uri, cid: prior.cid, publishedAt };
    }

    // 2. Legacy: the first deployments used deterministic netslum-<hex>
    // rkeys; Tranquil accepted them. Resolve those records so old drafts
    // still publish idempotently.
    const legacyRkey = deterministicPostRkey(draftRevision);
    try {
      const existing = await agent.com.atproto.repo.getRecord({
        repo: actorDid,
        collection: "app.bsky.feed.post",
        rkey: legacyRkey
      });
      const record = postRecordSchema.safeParse(existing.data.value).data;
      const publishedAt = record?.createdAt ?? new Date().toISOString();
      const cid = existing.data.cid ?? "";
      await this.finalizePublishedPost(actorDid, draftRevision, existing.data.uri, cid, record?.text ?? "", publishedAt);
      return { uri: existing.data.uri, cid, publishedAt };
    } catch { /* not previously published under the legacy key */ }


    const draft = await this.env.DB.prepare(
      "SELECT text,reply_to_uri,destination,quote_uri,quote_cid,languages,media_draft_ids FROM post_draft WHERE did=? AND revision=?"
    ).bind(actorDid, draftRevision).first<{
      text: string; reply_to_uri: string | null; destination: string;
      quote_uri: string | null; quote_cid: string | null;
      languages: string | null; media_draft_ids: string | null;
    }>();
    if (!draft) throw new NetslumError("STALE_REVISION", "Draft was modified or published", 409);

    // The stored text already carries the #netslum suffix for town drafts
    // (preparePost appended it); bluesky drafts publish as-is (plan §C3).
    const fullText = draft.destination === "bluesky" ? draft.text : draft.text;
    const richText = new RichText({ text: fullText, ...(draft.languages ? { langs: JSON.parse(draft.languages) as string[] } : {}) });
    await richText.detectFacets(agent);
    let reply: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } } | undefined;
    if (draft.reply_to_uri) {
      const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(draft.reply_to_uri);
      if (!match) throw new NetslumError("INVALID_INPUT", "Invalid reply URI", 400);
      const parentRecord = await agent.com.atproto.repo.getRecord({
        repo: match[1] ?? "",
        collection: "app.bsky.feed.post",
        rkey: match[2] ?? ""
      });
      const parentVal = replyRecordSchema.safeParse(parentRecord.data.value).data;
      const root = parentVal?.reply?.root ?? {
        uri: parentRecord.data.uri,
        cid: parentRecord.data.cid ?? ""
      };
      reply = {
        root,
        parent: { uri: parentRecord.data.uri, cid: parentRecord.data.cid ?? "" }
      };
    }

    // Embeds (plan §C3/C4): quote embeds reference the quoted record; media
    // embeds come from the actor's completed encrypted media drafts.
    let embed: Record<string, unknown> | undefined;
    const mediaRefs: Array<Record<string, unknown>> = [];
    if (draft.media_draft_ids) {
      const draftIds = JSON.parse(draft.media_draft_ids) as string[];
      for (const mediaDraftId of draftIds.slice(0, 4)) {
        try {
          mediaRefs.push(await this.mediaBlobRef(actorDid, mediaDraftId));
        } catch { /* a missing/expired draft attachment is skipped, not fatal */ }
      }
    }
    if (draft.quote_uri && draft.quote_cid) {
      const recordEmbed = { $type: "app.bsky.embed.record", record: { uri: draft.quote_uri, cid: draft.quote_cid } };
      embed = mediaRefs.length === 1
        ? { $type: "app.bsky.embed.record_with_media", record: recordEmbed, media: { $type: "app.bsky.embed.images", images: [mediaRefs[0]] } }
        : recordEmbed;
    } else if (mediaRefs.length === 1) {
      embed = { $type: "app.bsky.embed.images", images: [mediaRefs[0]] };
    } else if (mediaRefs.length > 1) {
      embed = { $type: "app.bsky.embed.images", images: mediaRefs };
    }

    const publishedAt = new Date().toISOString();
    const created = await agent.com.atproto.repo.createRecord({
      repo: actorDid,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: richText.text,
        facets: richText.facets,
        reply,
        ...(embed ? { embed } : {}),
        ...(draft.languages ? { langs: JSON.parse(draft.languages) as string[] } : {}),
        createdAt: publishedAt
      }
    });
    await this.finalizePublishedPost(
      actorDid,
      draftRevision,
      created.data.uri,
      created.data.cid,
      fullText,
      publishedAt
    );
    return { uri: created.data.uri, cid: created.data.cid, publishedAt };
  }


  /** Resolves the completed blob ref for one of the actor's media drafts. */
  private async mediaBlobRef(actorDid: string, draftId: string): Promise<Record<string, unknown>> {
    const media = new MediaService(this.env);
    return media.getBlob(actorDid, draftId);
  }
  async reactToPost(actorDid: string, input: { uri: string; cid: string; action: "like" | "unlike" | "repost" | "unrepost" }): Promise<{ action: string; uri: string; active: boolean }> {
    const isLike = input.action === "like" || input.action === "unlike";
    const kind = isLike ? "like" : "repost";
    const collection = `app.bsky.feed.${kind}`;
    const agent = await this.getAgent(actorDid);
    // app.bsky.feed.like/repost are lexicon key:"tid" collections, so records
    // use PDS-assigned TID rkeys. Idempotency is resolved by the durable
    // published_reaction mapping; a listRecords scan covers records created
    // by other clients or before this mapping existed.
    const findExisting = async (): Promise<string | null> => {
      const mapped = await this.env.DB.prepare(
        "SELECT uri FROM published_reaction WHERE actor_did=? AND kind=? AND subject_uri=?"
      ).bind(actorDid, kind, input.uri).first<{ uri: string }>();
      if (mapped) return mapped.uri.split("/").pop() ?? null;
      const legacyRkey = await deterministicReactionRkey(actorDid, kind, input.uri);
      try {
        const existing = await agent.com.atproto.repo.getRecord({ repo: actorDid, collection, rkey: legacyRkey });
        if (subjectRecordSchema.safeParse(existing.data.value).data?.subject?.uri === input.uri) return legacyRkey;
      } catch { /* legacy key not used */ }
      const list = await agent.com.atproto.repo.listRecords({
        repo: actorDid,
        collection,
        limit: 100
      });
      for (const rec of list.data.records) {
        const parsed = subjectRecordSchema.safeParse(rec.value).data;
        if (parsed?.subject?.uri === input.uri) return rec.uri.split("/").pop() ?? null;
      }
      return null;
    };

    if (kind === "like" || kind === "repost") {
      if (input.action === "like" || input.action === "repost") {
        const existingRkey = await findExisting();
        if (existingRkey) return { action: input.action, uri: input.uri, active: true };
        const created = await agent.com.atproto.repo.createRecord({
          repo: actorDid, collection,
          record: { $type: collection, subject: { uri: input.uri, cid: input.cid }, createdAt: new Date().toISOString() }
        });
        await this.env.DB.prepare(
          "INSERT INTO published_reaction(actor_did,kind,subject_uri,uri,cid,created_at) VALUES(?,?,?,?,?,?) " +
          "ON CONFLICT(actor_did,kind,subject_uri) DO UPDATE SET uri=excluded.uri,cid=excluded.cid"
        ).bind(actorDid, kind, input.uri, created.data.uri, created.data.cid, Date.now()).run();
        return { action: input.action, uri: input.uri, active: true };
      }
      const existingRkey = await findExisting();
      if (existingRkey) {
        try { await agent.com.atproto.repo.deleteRecord({ repo: actorDid, collection, rkey: existingRkey }); }
        catch { /* delete not found is active:false success */ }
        await this.env.DB.prepare("DELETE FROM published_reaction WHERE actor_did=? AND kind=? AND subject_uri=?")
          .bind(actorDid, kind, input.uri).run();
      }
      return { action: input.action, uri: input.uri, active: false };
    }
    return { action: input.action, uri: input.uri, active: false };
  }

  /** Timeline, thread, notifications, and search reads are proxied through
   * the Bluesky AppView with the authenticated actor's grant (plan §C3/C5). */
  private async proxiedAgent(actorDid: string): Promise<Agent> {
    const agent = await this.getAgent(actorDid);
    agent.configureProxy("did:web:api.bsky.app#bsky_appview");
    return agent;
  }

  private toPostSummary(post: Awaited<ReturnType<Agent["app"]["bsky"]["feed"]["getTimeline"]>>["data"]["feed"][number]["post"]): PostSummary {
    const record = postRecordSchema.safeParse(post.record).data;
    const author: PostSummary["author"] = { did: post.author.did, handle: post.author.handle };
    if (post.author.displayName) author.displayName = post.author.displayName;
    return {
      uri: post.uri,
      cid: post.cid,
      author,
      text: record?.text ?? "",
      createdAt: record?.createdAt ?? new Date().toISOString(),
      ...(post.embed ? { embeds: [post.embed as unknown as Record<string, unknown>] } : {})
    };
  }

  async getTimeline(actorDid: string, cursor?: string, limit = 5): Promise<{ posts: PostSummary[]; cursor?: string }> {
    const agent = await this.proxiedAgent(actorDid);
    const response = await agent.app.bsky.feed.getTimeline({ limit, ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Timeline unavailable", 503, true);
      });
    return {
      posts: response.data.feed.map((entry) => this.toPostSummary(entry.post)),
      ...(response.data.cursor ? { cursor: response.data.cursor } : {})
    };
  }

  async getPostThread(actorDid: string, uri: string, depth = 6): Promise<{ post: PostSummary; replies: PostSummary[] }> {
    const agent = await this.proxiedAgent(actorDid);
    const response = await agent.app.bsky.feed.getPostThread({ uri, depth }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("NOT_FOUND", "Thread not found", 404);
      });
    const thread = response.data.thread;
    if (!("post" in thread)) throw new NetslumError("NOT_FOUND", "Thread not found", 404);
    const replies: PostSummary[] = [];
    const walk = (node: unknown, level: number): void => {
      if (level <= 0 || !node || typeof node !== "object") return;
      const entry = node as { post?: unknown; replies?: unknown[] };
      if (entry.post && typeof entry.post === "object") {
        const summary = this.toPostSummary(entry.post as never);
        if (level < depth) replies.push(summary);
      }
      for (const child of entry.replies ?? []) walk(child, level - 1);
    };
    for (const child of (thread as { replies?: unknown[] }).replies ?? []) walk(child, depth);
    return { post: this.toPostSummary(thread.post), replies };
  }

  async deleteOwnPost(actorDid: string, uri: string): Promise<{ deleted: boolean }> {
    const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri);
    if (!match || match[1] !== actorDid) throw new NetslumError("FORBIDDEN", "You can only delete your own posts", 403);
    const agent = await this.getAgent(actorDid);
    await agent.com.atproto.repo.deleteRecord({ repo: actorDid, collection: "app.bsky.feed.post", rkey: match[2] ?? "" })
      .catch(() => {
        throw new NetslumError("NOT_FOUND", "Post not found", 404);
      });
    await this.env.DB.prepare("DELETE FROM feed_cache WHERE cache_key LIKE 'town:%'").run();
    return { deleted: true };
  }

  async listNotifications(actorDid: string, cursor?: string, limit = 25): Promise<{ notifications: Array<{ uri: string; reason: string; isRead: boolean; indexedAt: string; authorDid: string; authorHandle: string }>; cursor?: string }> {
    const agent = await this.proxiedAgent(actorDid);
    const response = await agent.app.bsky.notification.listNotifications({ limit, ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Notifications unavailable", 503, true);
      });
    return {
      notifications: response.data.notifications.map((entry) => ({
        uri: entry.uri,
        reason: entry.reason,
        isRead: entry.isRead,
        indexedAt: entry.indexedAt,
        authorDid: entry.author.did,
        authorHandle: entry.author.handle
      })),
      ...(response.data.cursor ? { cursor: response.data.cursor } : {})
    };
  }

  async markNotificationsSeen(actorDid: string, seenAt?: string): Promise<{ seenAt: string }> {
    const agent = await this.proxiedAgent(actorDid);
    const response = await agent.app.bsky.notification.updateSeen({ seenAt: seenAt ?? new Date().toISOString() }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Mark seen failed", 502);
      });
    void response;
    return { seenAt: seenAt ?? new Date().toISOString() };
  }

  async searchPosts(actorDid: string | undefined, query: string, cursor?: string, limit = 25): Promise<{ posts: PostSummary[]; cursor?: string }> {
    const agent = actorDid ? await this.proxiedAgent(actorDid) : await this.getAgent();
    const response = await agent.app.bsky.feed.searchPosts({ q: query, limit, ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Search unavailable", 503, true);
      });
    return {
      posts: response.data.posts.map((post) => this.toPostSummary(post)),
      ...(response.data.cursor ? { cursor: response.data.cursor } : {})
    };
  }

  /** Saved/custom feeds (plan §C3): reads and writes go through the
   * AppView-proxied preferences; only feed prefs are touched, other
   * preference types pass through untouched. */
  async getSavedFeeds(actorDid: string): Promise<Array<Record<string, unknown>>> {
    const agent = await this.proxiedAgent(actorDid);
    const response = await agent.app.bsky.actor.getPreferences({}, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Preferences unavailable", 503, true);
      });
    return response.data.preferences.filter((entry) => (entry as { $type?: string }).$type === "app.bsky.actor.defs#savedFeedsPrefV2") as unknown as Array<Record<string, unknown>>;
  }

  async setSavedFeed(actorDid: string, input: { uri: string; cid?: string; pinned?: boolean }): Promise<{ saved: boolean }> {
    const agent = await this.proxiedAgent(actorDid);
    const current = await agent.app.bsky.actor.getPreferences({}, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Preferences unavailable", 503, true);
      });
    const prefs = current.data.preferences as Array<Record<string, unknown>>;
    const feedIndex = prefs.findIndex((entry) => (entry as { $type?: string }).$type === "app.bsky.actor.defs#savedFeedsPrefV2");
    const feedPref = feedIndex >= 0 ? prefs[feedIndex] as { items?: Array<Record<string, unknown>> } : { $type: "app.bsky.actor.defs#savedFeedsPrefV2", items: [] };
    const items = Array.isArray(feedPref.items) ? feedPref.items : [];
    if (!items.some((item) => item.uri === input.uri)) {
      items.push({ uri: input.uri, ...(input.cid ? { cid: input.cid } : {}), pinned: input.pinned !== false });
    }
    feedPref.items = items;
    if (feedIndex >= 0) prefs[feedIndex] = feedPref; else prefs.push(feedPref);
    await agent.app.bsky.actor.putPreferences({ preferences: prefs as never }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Saving feed failed", 502);
      });
    return { saved: true };
  }

  async unsetSavedFeed(actorDid: string, uri: string): Promise<{ saved: boolean }> {
    const agent = await this.proxiedAgent(actorDid);
    const current = await agent.app.bsky.actor.getPreferences({}, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Preferences unavailable", 503, true);
      });
    const prefs = current.data.preferences as Array<Record<string, unknown>>;
    const feedIndex = prefs.findIndex((entry) => (entry as { $type?: string }).$type === "app.bsky.actor.defs#savedFeedsPrefV2");
    if (feedIndex >= 0) {
      const feedPref = prefs[feedIndex] as { items?: Array<{ uri?: string }> };
      if (Array.isArray(feedPref.items)) {
        feedPref.items = feedPref.items.filter((item) => item.uri !== uri);
        prefs[feedIndex] = feedPref;
        await agent.app.bsky.actor.putPreferences({ preferences: prefs as never }, { signal: AbortSignal.timeout(8000) })
          .catch(() => {
            throw new NetslumError("UPSTREAM_UNAVAILABLE", "Preferences update failed", 502);
          });
      }
    }
    return { saved: false };
  }

  async getAuthorFeed(actorDid: string | undefined, actor: string, cursor?: string, limit = 25): Promise<{ posts: PostSummary[]; cursor?: string }> {
    const agent = actorDid ? await this.proxiedAgent(actorDid) : await this.getAgent();
    const response = await agent.app.bsky.feed.getAuthorFeed({ actor, limit, ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Author feed unavailable", 503, true);
      });
    return {
      posts: response.data.feed.map((entry) => this.toPostSummary(entry.post)),
      ...(response.data.cursor ? { cursor: response.data.cursor } : {})
    };
  }

  async getPostEngagement(actorDid: string | undefined, uri: string, kind: "likes" | "reposts" | "quotes", limit = 25): Promise<{ actors: Array<{ did: string; handle: string }>; cursor?: string }> {
    const agent = actorDid ? await this.proxiedAgent(actorDid) : await this.getAgent();
    if (kind === "likes") {
      const response = await agent.app.bsky.feed.getLikes({ uri, limit }, { signal: AbortSignal.timeout(8000) })
        .catch(() => {
          throw new NetslumError("UPSTREAM_UNAVAILABLE", "Engagement unavailable", 503, true);
        });
      return { actors: response.data.likes.map((l) => ({ did: l.actor.did, handle: l.actor.handle })), ...(response.data.cursor ? { cursor: response.data.cursor } : {}) };
    }
    if (kind === "reposts") {
      const response = await agent.app.bsky.feed.getRepostedBy({ uri, limit }, { signal: AbortSignal.timeout(8000) })
        .catch(() => {
          throw new NetslumError("UPSTREAM_UNAVAILABLE", "Engagement unavailable", 503, true);
        });
      return { actors: response.data.repostedBy.map((a) => ({ did: a.did, handle: a.handle })), ...(response.data.cursor ? { cursor: response.data.cursor } : {}) };
    }
    const response = await agent.app.bsky.feed.getQuotes({ uri, limit }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", "Engagement unavailable", 503, true);
      });
    return { actors: response.data.posts.map((p) => ({ did: p.author.did, handle: p.author.handle })), ...(response.data.cursor ? { cursor: response.data.cursor } : {}) };
}

  /** Profile edits (plan §C2): get-record then putRecord with swapCid so
   * unknown/new fields are preserved and concurrent edits fail visibly. */
  async updateOwnProfile(actorDid: string, input: { displayName?: string | null; description?: string | null; avatarRef?: Record<string, unknown> | null; bannerRef?: Record<string, unknown> | null }): Promise<{ updated: true }> {
    const agent = await this.getAgent(actorDid);
    const existing = await agent.com.atproto.repo.getRecord({
      repo: actorDid,
      collection: "app.bsky.actor.profile",
      rkey: "self"
    }).catch(() => undefined);
    const current = existing ? existing.data.value as Record<string, unknown> : {};
    const record: Record<string, unknown> = { $type: "app.bsky.actor.profile", ...current };
    if (input.displayName !== undefined) {
      if (input.displayName === null) delete record.displayName; else record.displayName = input.displayName;
    }
    if (input.description !== undefined) {
      if (input.description === null) delete record.description; else record.description = input.description;
    }
    if (input.avatarRef !== undefined) {
      if (input.avatarRef === null) delete record.avatar; else record.avatar = input.avatarRef;
    }
    if (input.bannerRef !== undefined) {
      if (input.bannerRef === null) delete record.banner; else record.banner = input.bannerRef;
    }
    await agent.com.atproto.repo.putRecord({
      repo: actorDid,
      collection: "app.bsky.actor.profile",
      rkey: "self",
      record,
      ...(existing?.data.cid ? { swapRecord: existing.data.cid } : {})
    }, { signal: AbortSignal.timeout(10_000) }).catch((error) => {
      throw new NetslumError("RECORD_CONFLICT", `Profile update conflicted: ${String((error as Error).message ?? error).slice(0, 120)}`, 409);
    });
    return { updated: true };
  }
}
