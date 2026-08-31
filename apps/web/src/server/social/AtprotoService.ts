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

  async preparePost(actorDid: string, input: { text: string; replyToUri?: string; expectedRevision: string | null }): Promise<{ draftRevision: string; graphemes: number; bytes: number }> {
    const normalized = input.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const fullText = `${normalized}\n\n#netslum`;
    const graphemes = graphemeLength(fullText);
    const bytes = new TextEncoder().encode(fullText).byteLength;
    if (graphemes > 300 || bytes > 3000) throw new NetslumError("INVALID_INPUT", "Post exceeds AT Protocol limits", 400);
    const existing = await this.env.DB.prepare("SELECT draft_id,revision FROM post_draft WHERE did=?").bind(actorDid).first<DraftRow>();
    const extra1: { currentRevision?: string } = {};
    if (existing) extra1.currentRevision = existing.revision;
    if (input.expectedRevision === null && existing) throw new NetslumError("STALE_REVISION", "Draft revision mismatch", 409, false, extra1);
    const extra2: { currentRevision?: string } = {};
    if (existing?.revision) extra2.currentRevision = existing.revision;
    if (input.expectedRevision !== null && (!existing || existing.revision !== input.expectedRevision)) throw new NetslumError("STALE_REVISION", "Draft revision mismatch", 409, false, extra2);
    const draftId = existing?.draft_id ?? crypto.randomUUID();
    const draftRevision = await sha256Hex(JSON.stringify({ draftId, did: actorDid, text: normalized, replyToUri: input.replyToUri ?? null }));
    await this.env.DB.prepare("INSERT INTO post_draft(did,draft_id,revision,text,reply_to_uri,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(did) DO UPDATE SET revision=excluded.revision,text=excluded.text,reply_to_uri=excluded.reply_to_uri,updated_at=excluded.updated_at").bind(actorDid, draftId, draftRevision, normalized, input.replyToUri ?? null, Date.now()).run();
    return { draftRevision, graphemes, bytes };
  }

  async publishPreparedPost(actorDid: string, draftRevision: string): Promise<{ uri: string; cid: string; publishedAt: string }> {
    const rkey = deterministicPostRkey(draftRevision);
    const agent = await this.getAgent(actorDid);
    try {
      const existing = await agent.com.atproto.repo.getRecord({
        repo: actorDid,
        collection: "app.bsky.feed.post",
        rkey
      });
      const record = postRecordSchema.safeParse(existing.data.value).data;
      const publishedAt = record?.createdAt ?? new Date().toISOString();
      const cid = existing.data.cid ?? "";
      await this.finalizePublishedPost(
        actorDid,
        draftRevision,
        existing.data.uri,
        cid,
        record?.text ?? "",
        publishedAt
      );
      return { uri: existing.data.uri, cid, publishedAt };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Could not find record")) {
        const draftStillExists = await this.env.DB.prepare(
          "SELECT 1 AS present FROM post_draft WHERE did=? AND revision=?"
        ).bind(actorDid, draftRevision).first<{ present: number }>();
        if (!draftStillExists) throw error;
      }
    }

    const draft = await this.env.DB.prepare(
      "SELECT text,reply_to_uri FROM post_draft WHERE did=? AND revision=?"
    ).bind(actorDid, draftRevision).first<{ text: string; reply_to_uri: string | null }>();
    if (!draft) throw new NetslumError("STALE_REVISION", "Draft was modified or published", 409);

    const fullText = `${draft.text}\n\n#netslum`;
    const richText = new RichText({ text: fullText });
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

    const publishedAt = new Date().toISOString();
    const created = await agent.com.atproto.repo.createRecord({
      repo: actorDid,
      collection: "app.bsky.feed.post",
      rkey,
      record: {
        $type: "app.bsky.feed.post",
        text: richText.text,
        facets: richText.facets,
        reply,
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


  async reactToPost(actorDid: string, input: { uri: string; cid: string; action: "like" | "unlike" | "repost" | "unrepost" }): Promise<{ action: string; uri: string; active: boolean }> {
    const isLike = input.action === "like" || input.action === "unlike";
    const collection = isLike ? "app.bsky.feed.like" : "app.bsky.feed.repost";
    const rkey = await deterministicReactionRkey(actorDid, input.action, input.uri);
    const agent = await this.getAgent(actorDid);
    if (input.action === "like" || input.action === "repost") {
      try {
        const existing = await agent.com.atproto.repo.getRecord({ repo: actorDid, collection, rkey });
        const subject = subjectRecordSchema.safeParse(existing.data.value).data?.subject?.uri;
        if (subject === input.uri) return { action: input.action, uri: input.uri, active: true };
      } catch { /* create */ }
      await agent.com.atproto.repo.createRecord({
        repo: actorDid, collection, rkey,
        record: { $type: collection, subject: { uri: input.uri, cid: input.cid }, createdAt: new Date().toISOString() }
      });
      return { action: input.action, uri: input.uri, active: true };
    }
    try { await agent.com.atproto.repo.deleteRecord({ repo: actorDid, collection, rkey }); }
    catch { /* delete not found is active:false success */ }
    return { action: input.action, uri: input.uri, active: false };
  }
}
