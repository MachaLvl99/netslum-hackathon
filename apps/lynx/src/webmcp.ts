/// <reference types="webmcp-types" />
import {
  feedQuerySchema,
  parseZoneKey,
  publishPostSchema,
  publishSiteSchema,
  reactionSchema,
  readSiteFileSchema,
  saveSiteFileSchema,
  deleteSiteFileSchema,
  zoneMutationSchema,
  zonePrefixes,
  zonePlaces,
  zoneStates,
  type ToolResult
} from "@netslum/contracts";
import { z } from "zod";

export interface SessionInfo {
  authenticated: boolean;
  did?: string;
  handle?: string;
  displayHandle?: string;
  canPublishSite?: boolean;
  dmAgentEnabled?: boolean;
  reauthorizeRequired?: boolean;
}

interface TownFeedRes {
  posts: Array<{ uri: string; author: { handle: string }; text: string; createdAt: string }>;
  cursor?: string;
  stale: boolean;
}

interface ChaosGateRes {
  zoneKey: string;
  version: number;
  objects: Array<{ id: string; type: string; x: number; y: number; text?: string; shape?: string; color?: string; targetZoneKey?: string }>;
}

interface ProfileRes {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
}

interface PreparePostRes {
  draftRevision: string;
  graphemes: number;
  bytes: number;
}

interface PublishPostRes {
  uri: string;
  cid: string;
  publishedAt: string;
}

interface ReactionRes {
  action: string;
  uri: string;
  active: boolean;
}

interface MutateZoneRes {
  zoneKey: string;
  version: number;
  changedIds: string[];
}

interface SiteDraftRes {
  slug: string;
  revision: string;
  files: Array<{ path: string; size: number; mimeType: string }>;
}

interface SiteFileRes {
  path: string;
  content: string;
  encoding: string;
  revision: string;
  nextOffset?: number;
}

interface SaveSiteFileRes {
  revision: string;
  size: number;
  sha256: string;
}

interface DeleteSiteFileRes {
  revision: string;
}

interface PublishSiteRes {
  url: string;
  revision: string;
  atUri: string;
  atCid: string;
  runtimeUrl: string | null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const errorBody: unknown = await res.json().catch(() => ({ code: "UPSTREAM_UNAVAILABLE", message: "Request failed" }));
    throw errorBody;
  }
  const json: unknown = await res.json();
  return json as T;
}

export function registerNetslumTools(
  navigate: (route: string) => void,
  session: SessionInfo,
  signal: AbortSignal
): void {
  if (typeof document === "undefined" || typeof document.modelContext?.registerTool !== "function") {
    return;
  }

  const getCsrf = (): string => {
    for (const part of document.cookie.split(";")) {
      const [k, v] = part.trim().split("=");
      if (k === "__Host-netslum-csrf" && v) return decodeURIComponent(v);
    }
    return "";
  };

  const dispatchState = (action: string, data: unknown): void => {
    window.dispatchEvent(new CustomEvent("netslum:state", { detail: { action, data } }));
  };

  const wrapResult = <T>(action: string, url: string, data: T): ToolResult<T> => {
    dispatchState(action, data);
    return { ok: true, action, url, data };
  };

  const wrapError = (action: string, url: string, err: unknown): ToolResult<never> => {
    let code = "WORKER_FAILED";
    let message = "Tool execution failed";
    let retryable = false;
    let extraData: { currentRevision?: string; currentVersion?: number } | undefined;

    if (err && typeof err === "object") {
      const errObj = err as Record<string, unknown>;
      if (typeof errObj.code === "string") code = errObj.code;
      if (typeof errObj.message === "string") message = errObj.message;
      if (typeof errObj.retryable === "boolean") retryable = errObj.retryable;
      if (errObj.data && typeof errObj.data === "object") {
        extraData = errObj.data as { currentRevision?: string; currentVersion?: number };
      }
    }

    const error = { code, message, retryable };
    if (extraData) return { ok: false, action, url, error, data: extraData };
    return { ok: false, action, url, error };
  };

  // 1. show_town_square
  void document.modelContext.registerTool({
    name: "show_town_square",
    description: "Open the town square and fetch the live Bluesky #netslum social feed.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: { type: "string", maxLength: 512, description: "Pagination cursor" },
        limit: { type: "integer", minimum: 1, maximum: 5, description: "Page limit (1..5)" }
      },
      additionalProperties: false,
      required: []
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = feedQuerySchema.parse(input ?? {});
        navigate("/");
        const url = `/api/feed?limit=${parsed.limit}${parsed.cursor ? `&cursor=${encodeURIComponent(parsed.cursor)}` : ""}`;
        const data = await fetchJson<TownFeedRes>(url, { ...(options?.signal ? { signal: options.signal } : {}) });
        const bounded = {
          posts: data.posts.slice(0, 5).map((p) => ({
            uri: p.uri,
            author: p.author.handle,
            textPreview: p.text.slice(0, 240),
            createdAt: p.createdAt
          })),
          cursor: data.cursor,
          stale: data.stale
        };
        return wrapResult("show_town_square", "/town", bounded);
      } catch (err) {
        return wrapError("show_town_square", "/town", err);
      }
    }
  }, { signal });

  // 2. open_chaos_gate
  void document.modelContext.registerTool({
    name: "open_chaos_gate",
    description: "Navigate to a collaborative Chaos Gate zone using 3 ordered keywords.",
    inputSchema: {
      type: "object",
      required: ["prefix", "place", "state"],
      properties: {
        prefix: { type: "string", enum: zonePrefixes },
        place: { type: "string", enum: zonePlaces },
        state: { type: "string", enum: zoneStates }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const schema = z.object({
          prefix: z.enum(zonePrefixes),
          place: z.enum(zonePlaces),
          state: z.enum(zoneStates)
        }).strict();
        const { prefix, place, state } = schema.parse(input);
        const zoneKey = `${prefix}.${place}.${state}`;
        const route = `/zone/${zoneKey}`;
        navigate(route);
        const data = await fetchJson<ChaosGateRes>(`/api/zones/${zoneKey}`, { ...(options?.signal ? { signal: options.signal } : {}) });
        const summaries = data.objects.slice(0, 10).map((o) => {
          let preview = "";
          if (o.type === "note") preview = o.text?.slice(0, 80) ?? "";
          else if (o.type === "sigil") preview = `${o.shape ?? ""} ${o.color ?? ""}`;
          else if (o.type === "portal") preview = `-> ${o.targetZoneKey ?? ""}`;
          return { id: o.id, type: o.type, x: o.x, y: o.y, preview };
        });
        return wrapResult("open_chaos_gate", route, {
          zoneKey: data.zoneKey,
          version: data.version,
          objects: summaries,
          truncated: data.objects.length > 10
        });
      } catch (err) {
        return wrapError("open_chaos_gate", "/gate", err);
      }
    }
  }, { signal });

  // 3. show_profile
  void document.modelContext.registerTool({
    name: "show_profile",
    description: "Look up an AT Protocol actor profile and page link.",
    inputSchema: {
      type: "object",
      required: ["actor"],
      properties: {
        actor: { type: "string", minLength: 1, maxLength: 253, description: "Handle or DID" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const schema = z.object({ actor: z.string().min(1).max(253) }).strict();
        const { actor } = schema.parse(input);
        const route = `/profile/${encodeURIComponent(actor)}`;
        navigate(route);
        const data = await fetchJson<ProfileRes>(`/api/profile/${encodeURIComponent(actor)}`, { ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("show_profile", route, {
          did: data.did,
          handle: data.handle,
          displayName: data.displayName,
          descriptionPreview: data.description?.slice(0, 240),
          pageUrl: `/@${data.handle.split(".")[0]}`
        });
      } catch (err) {
        return wrapError("show_profile", "/profile", err);
      }
    }
  }, { signal });

  if (!session.authenticated) return;

  // 4. prepare_post (V2)
  void document.modelContext.registerTool({
    name: "prepare_post",
    description: "Draft an AT Protocol post with automatic #netslum tag or Bluesky destination. Prepares only; does not publish.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", maxLength: 4000, description: "Draft text content" },
        destination: { type: "string", enum: ["town", "bluesky"], description: "Destination feed: 'town' (includes #netslum tag) or 'bluesky' (verbatim)" },
        replyToUri: { type: "string", description: "Optional AT URI of post to reply to" },
        quoteUri: { type: "string", description: "Optional AT URI of post to quote" },
        quoteCid: { type: "string", description: "Optional CID of post to quote" },
        languages: { type: "array", items: { type: "string", maxLength: 8 }, maxItems: 3, description: "Language tags (e.g. ['en'])" },
        mediaDraftIds: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 4, description: "IDs of prepared media drafts" },
        expectedRevision: { type: ["string", "null"], description: "Draft revision hash if modifying an existing draft" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const schema = z.object({
          text: z.string().max(4000),
          destination: z.enum(["town", "bluesky"]).optional(),
          replyToUri: z.string().max(2048).optional(),
          quoteUri: z.string().max(2048).optional(),
          quoteCid: z.string().max(200).optional(),
          languages: z.array(z.string().max(8)).max(3).optional(),
          mediaDraftIds: z.array(z.string().max(64)).max(4).optional(),
          expectedRevision: z.string().max(64).nullable().optional()
        }).strict();
        const parsed = schema.parse(input);
        const data = await fetchJson<PreparePostRes>("/api/post-draft", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify({
            text: parsed.text,
            destination: parsed.destination ?? "town",
            expectedRevision: parsed.expectedRevision ?? null,
            ...(parsed.replyToUri !== undefined ? { replyToUri: parsed.replyToUri } : {}),
            ...(parsed.quoteUri !== undefined ? { quoteUri: parsed.quoteUri } : {}),
            ...(parsed.quoteCid !== undefined ? { quoteCid: parsed.quoteCid } : {}),
            ...(parsed.languages !== undefined ? { languages: parsed.languages } : {}),
            ...(parsed.mediaDraftIds !== undefined ? { mediaDraftIds: parsed.mediaDraftIds } : {})
          }),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("prepare_post", "/town", {
          draftRevision: data.draftRevision,
          graphemes: data.graphemes,
          bytes: data.bytes,
          replyToUri: parsed.replyToUri
        });
      } catch (err) {
        return wrapError("prepare_post", "/town", err);
      }
    }
  }, { signal });

  // 5. publish_prepared_post
  void document.modelContext.registerTool({
    name: "publish_prepared_post",
    description: "Publish a previously prepared draft to AT Protocol Bluesky feed.",
    inputSchema: {
      type: "object",
      required: ["draftRevision"],
      properties: {
        draftRevision: { type: "string", pattern: "^[a-f0-9]{64}$", description: "64-hex draft revision to publish" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = publishPostSchema.parse(input);
        const data = await fetchJson<PublishPostRes>("/api/posts/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("publish_prepared_post", "/town", data);
      } catch (err) {
        return wrapError("publish_prepared_post", "/town", err);
      }
    }
  }, { signal });

  // 6. react_to_post
  void document.modelContext.registerTool({
    name: "react_to_post",
    description: "Like, unlike, repost, or unrepost an AT Protocol post.",
    inputSchema: {
      type: "object",
      required: ["uri", "cid", "action"],
      properties: {
        uri: { type: "string", description: "AT URI of target post" },
        cid: { type: "string", description: "CID of target post" },
        action: { type: "string", enum: ["like", "unlike", "repost", "unrepost"] }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = reactionSchema.parse(input);
        const data = await fetchJson<ReactionRes>("/api/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("react_to_post", "/town", data);
      } catch (err) {
        return wrapError("react_to_post", "/town", err);
      }
    }
  }, { signal });

  // 7. mutate_zone
  void document.modelContext.registerTool({
    name: "mutate_zone",
    description: "Batch mutate notes, sigils, or portals in a Chaos Gate zone.",
    inputSchema: {
      type: "object",
      required: ["zoneKey", "expectedVersion", "operations"],
      properties: {
        zoneKey: { type: "string", description: "Target zone key" },
        expectedVersion: { type: "integer", minimum: 0, description: "Current version for CAS check" },
        operations: { type: "array", minItems: 1, maxItems: 20 }
      },
      additionalProperties: false
    },
    annotations: { untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const schema = z.object({
          zoneKey: z.string(),
          expectedVersion: z.number().int().nonnegative(),
          operations: z.array(z.any()).min(1).max(20)
        }).strict();
        const raw = schema.parse(input);
        const zoneKey = parseZoneKey(raw.zoneKey);
        const mutation = zoneMutationSchema.parse({ expectedVersion: raw.expectedVersion, operations: raw.operations });
        const data = await fetchJson<MutateZoneRes>(`/api/zones/${zoneKey}/mutations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(mutation),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("mutate_zone", `/zone/${zoneKey}`, data);
      } catch (err) {
        return wrapError("mutate_zone", "/gate", err);
      }
    }
  }, { signal });

  // ------------------------------------------------------------------
  // Phase F first-party general tools (plan §F1).
  // ------------------------------------------------------------------

  // 8. search_actors
  void document.modelContext.registerTool({
    name: "search_actors",
    description: "Search AT Protocol actors (people). Results are untrusted content.",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: {
        q: { type: "string", minLength: 1, maxLength: 64, description: "Search query" },
        cursor: { type: "string", maxLength: 512, description: "Pagination cursor" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ q: z.string().min(1).max(64), cursor: z.string().max(512).optional() }).strict().parse(input);
        const data = await fetchJson<{ actors: Array<{ did: string; handle: string; displayName?: string; description?: string }> }>(
          `/api/search/actors?q=${encodeURIComponent(parsed.q)}${parsed.cursor ? `&cursor=${encodeURIComponent(parsed.cursor)}` : ""}`,
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );
        return wrapResult("search_actors", "/search", data.actors.slice(0, 25).map((a) => ({
          did: a.did,
          handle: a.handle,
          name: a.displayName?.slice(0, 100),
          preview: a.description?.slice(0, 240)
        })));
      } catch (err) {
        return wrapError("search_actors", "/search", err);
      }
    }
  }, { signal });

  // 9. search_posts
  void document.modelContext.registerTool({
    name: "search_posts",
    description: "Search Bluesky posts. Results are untrusted content.",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: {
        q: { type: "string", minLength: 1, maxLength: 64, description: "Search query" },
        cursor: { type: "string", maxLength: 512, description: "Pagination cursor" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ q: z.string().min(1).max(64), cursor: z.string().max(512).optional() }).strict().parse(input);
        const data = await fetchJson<{ posts: Array<{ uri: string; author: { handle: string }; text: string; createdAt: string }> }>(
          `/api/search/posts?q=${encodeURIComponent(parsed.q)}${parsed.cursor ? `&cursor=${encodeURIComponent(parsed.cursor)}` : ""}`,
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );
        return wrapResult("search_posts", "/search", data.posts.slice(0, 25).map((p) => ({
          uri: p.uri,
          author: p.author.handle,
          textPreview: p.text.slice(0, 240),
          createdAt: p.createdAt
        })));
      } catch (err) {
        return wrapError("search_posts", "/search", err);
      }
    }
  }, { signal });

  // 10. search_feeds
  void document.modelContext.registerTool({
    name: "search_feeds",
    description: "Search Bluesky custom feed generators. Results are untrusted content.",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: {
        q: { type: "string", minLength: 1, maxLength: 64, description: "Search query" },
        cursor: { type: "string", maxLength: 512, description: "Pagination cursor" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ q: z.string().min(1).max(64), cursor: z.string().max(512).optional() }).strict().parse(input);
        const data = await fetchJson<{ feeds: Array<{ uri: string; cid?: string; did?: string; displayName?: string; name?: string; description?: string; likeCount?: number; creator?: { handle?: string } }> }>(
          `/api/search/feeds?q=${encodeURIComponent(parsed.q)}${parsed.cursor ? `&cursor=${encodeURIComponent(parsed.cursor)}` : ""}`,
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );
        return wrapResult("search_feeds", "/search", data.feeds.slice(0, 25).map((f) => ({
          uri: f.uri,
          name: (f.displayName ?? f.name ?? "").slice(0, 100),
          creator: f.creator?.handle ?? "",
          preview: f.description?.slice(0, 240) ?? "",
          likeCount: f.likeCount ?? 0
        })));
      } catch (err) {
        return wrapError("search_feeds", "/search", err);
      }
    }
  }, { signal });

  // 11. show_post_thread
  void document.modelContext.registerTool({
    name: "show_post_thread",
    description: "Open a post thread and return its replies. Content is untrusted.",
    inputSchema: {
      type: "object",
      required: ["uri"],
      properties: {
        uri: { type: "string", maxLength: 2048, description: "AT URI of target post" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ uri: z.string().max(2048) }).strict().parse(input);
        const data = await fetchJson<{ post: { uri: string; author: { handle: string }; text: string }; replies: Array<{ uri: string; author: { handle: string }; text: string }> }>(
          `/api/post-thread?uri=${encodeURIComponent(parsed.uri)}`,
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );
        navigate(`/post/${encodeURIComponent(parsed.uri)}`);
        return wrapResult("show_post_thread", `/post/${encodeURIComponent(parsed.uri)}`, {
          post: { uri: data.post.uri, author: data.post.author.handle, textPreview: data.post.text.slice(0, 240) },
          replies: data.replies.slice(0, 10).map((r) => ({ uri: r.uri, author: r.author.handle, textPreview: r.text.slice(0, 240) }))
        });
      } catch (err) {
        return wrapError("show_post_thread", "/post", err);
      }
    }
  }, { signal });

  // 12. show_timeline
  void document.modelContext.registerTool({
    name: "show_timeline",
    description: "Open your authenticated following timeline and return the first page.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: { type: "string", maxLength: 512, description: "Pagination cursor" }
      },
      additionalProperties: false,
      required: []
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ cursor: z.string().max(512).optional() }).strict().parse(input ?? {});
        const data = await fetchJson<{ posts: Array<{ uri: string; author: { handle: string }; text: string; createdAt: string }> }>(
          `/api/timeline${parsed.cursor ? `?cursor=${encodeURIComponent(parsed.cursor)}` : ""}`,
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );
        navigate("/timeline");
        return wrapResult("show_timeline", "/timeline", data.posts.slice(0, 25).map((p) => ({
          uri: p.uri,
          author: p.author.handle,
          textPreview: p.text.slice(0, 240)
        })));
      } catch (err) {
        return wrapError("show_timeline", "/timeline", err);
      }
    }
  }, { signal });

  // 13. show_feed
  void document.modelContext.registerTool({
    name: "show_feed",
    description: "Open a custom feed generator by AT URI and return its posts. Content is untrusted.",
    inputSchema: {
      type: "object",
      required: ["feedUri"],
      properties: {
        feedUri: { type: "string", maxLength: 2048, description: "AT URI of custom feed generator" },
        cursor: { type: "string", maxLength: 512, description: "Pagination cursor" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ feedUri: z.string().max(2048), cursor: z.string().max(512).optional() }).strict().parse(input);
        navigate("/town");
        const url = `/api/feed/custom?feed=${encodeURIComponent(parsed.feedUri)}${parsed.cursor ? `&cursor=${encodeURIComponent(parsed.cursor)}` : ""}`;
        const data = await fetchJson<{ posts: Array<{ uri: string; author: { handle: string }; text: string; createdAt: string }> }>(url, { ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("show_feed", "/town", data.posts.slice(0, 25).map((p) => ({
          uri: p.uri,
          author: p.author.handle,
          textPreview: p.text.slice(0, 240),
          createdAt: p.createdAt
        })));
      } catch (err) {
        return wrapError("show_feed", "/town", err);
      }
    }
  }, { signal });

  // 14. list_notifications
  void document.modelContext.registerTool({
    name: "list_notifications",
    description: "List your notifications (mentions, likes, reposts, follows).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
      required: []
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        void input;
        const data = await fetchJson<{ notifications: Array<{ uri: string; reason: string; isRead: boolean; authorHandle: string }> }>(
          "/api/notifications",
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );
        navigate("/notifications");
        return wrapResult("list_notifications", "/notifications", data.notifications.slice(0, 25).map((n) => ({
          reason: n.reason,
          author: n.authorHandle,
          uri: n.uri,
          isRead: n.isRead
        })));
      } catch (err) {
        return wrapError("list_notifications", "/notifications", err);
      }
    }
  }, { signal });

  // 15. mark_notifications_seen
  void document.modelContext.registerTool({
    name: "mark_notifications_seen",
    description: "Marks all notifications as seen. Durable effect on your account state.",
    inputSchema: {
      type: "object",
      properties: {
        seenAt: { type: "string", maxLength: 40, description: "Optional ISO timestamp" }
      },
      additionalProperties: false,
      required: []
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ seenAt: z.string().max(40).optional() }).strict().parse(input ?? {});
        const data = await fetchJson<{ seenAt: string }>("/api/notifications/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("mark_notifications_seen", "/notifications", data);
      } catch (err) {
        return wrapError("mark_notifications_seen", "/notifications", err);
      }
    }
  }, { signal });

  // 16. set_follow_state
  void document.modelContext.registerTool({
    name: "set_follow_state",
    description: "Follow or unfollow an actor by handle or DID. Durable effect on your graph.",
    inputSchema: {
      type: "object",
      required: ["actor", "follow"],
      properties: {
        actor: { type: "string", maxLength: 315, description: "Actor handle or DID" },
        follow: { type: "boolean", description: "True to follow, false to unfollow" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ actor: z.string().max(315), follow: z.boolean() }).strict().parse(input);
        const data = await fetchJson<{ following: boolean }>("/api/graph/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("set_follow_state", `/profile/${encodeURIComponent(parsed.actor)}`, data);
      } catch (err) {
        return wrapError("set_follow_state", "/profile", err);
      }
    }
  }, { signal });

  // 17. set_moderation_state
  void document.modelContext.registerTool({
    name: "set_moderation_state",
    description: "Block/unblock or mute/unmute an actor. Durable moderation effect.",
    inputSchema: {
      type: "object",
      required: ["actor", "kind", "enable"],
      properties: {
        actor: { type: "string", maxLength: 315, description: "Actor handle or DID" },
        kind: { type: "string", enum: ["block", "mute"], description: "Moderation action kind" },
        enable: { type: "boolean", description: "True to enable block/mute, false to disable" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ actor: z.string().max(315), kind: z.enum(["block", "mute"]), enable: z.boolean() }).strict().parse(input);
        const endpoint = parsed.kind === "block" ? "/api/graph/block" : "/api/graph/mute";
        const body = parsed.kind === "block" ? { actor: parsed.actor, block: parsed.enable } : { actor: parsed.actor, mute: parsed.enable };
        const data = await fetchJson<Record<string, unknown>>(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(body),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("set_moderation_state", "/settings", data);
      } catch (err) {
        return wrapError("set_moderation_state", "/settings", err);
      }
    }
  }, { signal });

  // 18. report_content
  void document.modelContext.registerTool({
    name: "report_content",
    description: "Report a record to moderation. Durable effect; cannot be undone by this tool.",
    inputSchema: {
      type: "object",
      required: ["subjectUri", "reasonType"],
      properties: {
        subjectUri: { type: "string", maxLength: 2048, description: "AT URI of content being reported" },
        subjectCid: { type: "string", maxLength: 200, description: "Optional CID of reported content" },
        reasonType: { type: "string", maxLength: 100, description: "com.atproto.moderation reason type" },
        comment: { type: "string", maxLength: 500, description: "Optional reporter comment" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({
          subjectUri: z.string().max(2048),
          subjectCid: z.string().max(200).optional(),
          reasonType: z.string().max(100),
          comment: z.string().max(500).optional()
        }).strict().parse(input);
        const data = await fetchJson<{ reported: true }>("/api/moderation/report", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("report_content", "/settings", data);
      } catch (err) {
        return wrapError("report_content", "/settings", err);
      }
    }
  }, { signal });

  // 19. delete_own_post
  void document.modelContext.registerTool({
    name: "delete_own_post",
    description: "Delete one of your own posts by AT URI. Durable and irreversible.",
    inputSchema: {
      type: "object",
      required: ["uri"],
      properties: {
        uri: { type: "string", maxLength: 2048, description: "AT URI of post to delete" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ uri: z.string().max(2048) }).strict().parse(input);
        const data = await fetchJson<{ deleted: boolean }>(`/api/posts/${encodeURIComponent(parsed.uri)}`, {
          method: "DELETE",
          headers: { "X-CSRF-Token": getCsrf() },
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("delete_own_post", "/town", data);
      } catch (err) {
        return wrapError("delete_own_post", "/town", err);
      }
    }
  }, { signal });

  // 20. show_home
  void document.modelContext.registerTool({
    name: "show_home",
    description: "Show signed-in home settings and active mode (standard or authored).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
      required: []
    },
    annotations: { readOnlyHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        void input;
        const data = await fetchJson<{ mode: string; activeHomePath?: string | null }>("/api/home/settings", {
          ...(options?.signal ? { signal: options.signal } : {})
        });
        navigate("/");
        return wrapResult("show_home", "/", { mode: data.mode, activeHomePath: data.activeHomePath ?? null });
      } catch (err) {
        return wrapError("show_home", "/", err);
      }
    }
  }, { signal });

  // 21. set_home_mode
  void document.modelContext.registerTool({
    name: "set_home_mode",
    description: "Switch your signed-in home between the standard landing and your authored site home. Local accounts only.",
    inputSchema: {
      type: "object",
      required: ["mode"],
      properties: {
        mode: { type: "string", enum: ["standard", "authored"], description: "Home page mode" },
        activeHomePath: { type: "string", maxLength: 128, description: "Optional path to authored home file" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ mode: z.enum(["standard", "authored"]), activeHomePath: z.string().max(128).optional() }).strict().parse(input);
        const data = await fetchJson<{ mode: string }>("/api/home/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify({ mode: parsed.mode, activeHomePath: parsed.activeHomePath ?? (parsed.mode === "authored" ? "home.html" : null) }),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("set_home_mode", "/", data);
      } catch (err) {
        return wrapError("set_home_mode", "/", err);
      }
    }
  }, { signal });

  // Layout target helpers
  const readLayoutTarget = async (target: "homepage" | "personal_page", optSignal?: AbortSignal): Promise<Record<string, unknown> | null> => {
    const url = target === "homepage" ? "/api/home/schema" : "/api/sites/schema";
    const data = await fetchJson<{ schema: Record<string, unknown> | null }>(url, { ...(optSignal ? { signal: optSignal } : {}) });
    return data.schema;
  };

  const writeLayoutTarget = async (target: "homepage" | "personal_page", schema: Record<string, unknown> | null, optSignal?: AbortSignal): Promise<{ ok: boolean }> => {
    const url = target === "homepage" ? "/api/home/schema" : "/api/sites/schema";
    const data = await fetchJson<{ ok: boolean }>(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
      body: JSON.stringify({ schema }),
      ...(optSignal ? { signal: optSignal } : {})
    });
    window.dispatchEvent(new CustomEvent("netslum:state", { detail: { action: "set_home_layout", data: schema } }));
    return data;
  };

  // 21b. get_page_layout
  void document.modelContext.registerTool({
    name: "get_page_layout",
    description: "Inspect the active UI component tree layout for either your private homepage or public personal page.",
    inputSchema: {
      type: "object",
      required: ["target"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"], description: "'homepage' (private) or 'personal_page' (public)" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ target: z.enum(["homepage", "personal_page"]) }).parse(input);
        const schema = await readLayoutTarget(parsed.target, options?.signal);
        return wrapResult("get_page_layout", "/", { target: parsed.target, schema });
      } catch (err) {
        return wrapError("get_page_layout", "/", err);
      }
    }
  }, { signal });

  // 21c. update_page_layout
  void document.modelContext.registerTool({
    name: "update_page_layout",
    description: "Replace or update the full component tree schema for your private homepage or public personal page.",
    inputSchema: {
      type: "object",
      required: ["target", "schema"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"], description: "Target surface to update" },
        schema: { type: "object", description: "Root component node or DynamicPageSchema" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({
          target: z.enum(["homepage", "personal_page"]),
          schema: z.record(z.string(), z.unknown()).nullable()
        }).parse(input);
        await writeLayoutTarget(parsed.target, parsed.schema, options?.signal);
        return wrapResult("update_page_layout", "/", { ok: true, target: parsed.target, schema: parsed.schema });
      } catch (err) {
        return wrapError("update_page_layout", "/", err);
      }
    }
  }, { signal });

  // 21d. add_ui_card
  void document.modelContext.registerTool({
    name: "add_ui_card",
    description: "Append a styled Card widget (with title, body, optional action button/badge) to your homepage or personal page.",
    inputSchema: {
      type: "object",
      required: ["target", "title", "body"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"] },
        title: { type: "string", maxLength: 100 },
        body: { type: "string", maxLength: 500 },
        badge: { type: "string", maxLength: 30 },
        buttonLabel: { type: "string", maxLength: 50 },
        route: { type: "string", maxLength: 100 }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({
          target: z.enum(["homepage", "personal_page"]),
          title: z.string().max(100),
          body: z.string().max(500),
          badge: z.string().max(30).optional(),
          buttonLabel: z.string().max(50).optional(),
          route: z.string().max(100).optional()
        }).parse(input);

        const current = (await readLayoutTarget(parsed.target, options?.signal)) ?? {
          root: { type: "Box", props: { gap: "large", pad: "large" }, children: [] }
        };
        const root = ("root" in current && typeof current.root === "object" && current.root !== null ? current.root : current) as { type: string; props?: Record<string, unknown>; children?: Array<Record<string, unknown>> };
        if (!Array.isArray(root.children)) root.children = [];

        const cardChildren: Array<Record<string, unknown>> = [
          {
            type: "CardHeader",
            children: [
              { type: "Heading", props: { level: 3, color: "brand", mono: true }, children: parsed.title },
              ...(parsed.badge ? [{ type: "Badge", props: { value: parsed.badge, variant: "brand" } }] : [])
            ]
          },
          { type: "CardBody", children: [{ type: "Paragraph", props: { color: "textMuted" }, children: parsed.body }] },
          ...(parsed.buttonLabel ? [{ type: "CardFooter", children: [{ type: "Button", props: { label: parsed.buttonLabel, variant: "primary", route: parsed.route } }] }] : [])
        ];

        root.children.push({
          type: "Card",
          props: { background: "surface", border: { color: "borderSubtle", size: "1px" }, pad: "large", gap: "medium" },
          children: cardChildren
        });

        await writeLayoutTarget(parsed.target, current, options?.signal);
        return wrapResult("add_ui_card", "/", { ok: true, target: parsed.target, cardAdded: parsed.title });
      } catch (err) {
        return wrapError("add_ui_card", "/", err);
      }
    }
  }, { signal });

  // 21e. populate_feed_widget
  void document.modelContext.registerTool({
    name: "populate_feed_widget",
    description: "Harvest Bluesky posts by query keyword or actor handle and inject a live FeedWidget onto your homepage or personal page.",
    inputSchema: {
      type: "object",
      required: ["target"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"] },
        query: { type: "string", maxLength: 200, description: "Search term or tag (e.g. 'netslum')" },
        actor: { type: "string", maxLength: 315, description: "Actor handle to harvest posts from" },
        title: { type: "string", maxLength: 100, description: "Widget header title" },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "Number of posts to harvest (1..10)" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({
          target: z.enum(["homepage", "personal_page"]),
          query: z.string().max(200).optional(),
          actor: z.string().max(315).optional(),
          title: z.string().max(100).optional(),
          limit: z.number().int().min(1).max(10).optional().default(5)
        }).parse(input);

        let posts: Array<{ uri: string; author: string; text: string; createdAt?: string }> = [];
        if (parsed.actor) {
          const feedRes = await fetchJson<{ posts: Array<{ uri: string; author: { handle: string }; text: string; createdAt: string }> }>(
            `/api/author-feed?actor=${encodeURIComponent(parsed.actor)}&limit=${parsed.limit}`,
            { ...(options?.signal ? { signal: options.signal } : {}) }
          );
          posts = feedRes.posts.map((p) => ({ uri: p.uri, author: p.author?.handle ?? parsed.actor ?? "", text: p.text, createdAt: p.createdAt }));
        } else if (parsed.query) {
          const searchRes = await fetchJson<{ posts: Array<{ uri: string; author: { handle: string }; text: string; createdAt: string }> }>(
            `/api/search/posts?q=${encodeURIComponent(parsed.query)}&limit=${parsed.limit}`,
            { ...(options?.signal ? { signal: options.signal } : {}) }
          );
          posts = searchRes.posts.map((p) => ({ uri: p.uri, author: p.author?.handle ?? "unknown", text: p.text, createdAt: p.createdAt }));
        } else {
          const townRes = await fetchJson<{ posts: Array<{ uri: string; author: { handle: string }; text: string; createdAt: string }> }>(
            `/api/feed?limit=${parsed.limit}`,
            { ...(options?.signal ? { signal: options.signal } : {}) }
          );
          posts = townRes.posts.map((p) => ({ uri: p.uri, author: p.author?.handle ?? "town", text: p.text, createdAt: p.createdAt }));
        }

        const current = (await readLayoutTarget(parsed.target, options?.signal)) ?? {
          root: { type: "Box", props: { gap: "large", pad: "large" }, children: [] }
        };
        const root = ("root" in current && typeof current.root === "object" && current.root !== null ? current.root : current) as { type: string; props?: Record<string, unknown>; children?: Array<Record<string, unknown>> };
        if (!Array.isArray(root.children)) root.children = [];

        root.children.push({
          type: "FeedWidget",
          props: {
            title: parsed.title ?? (parsed.actor ? `@${parsed.actor.replace(/^@/, "")} DISPATCHES` : parsed.query ? `#${parsed.query} STREAM` : "DISPATCHES"),
            posts
          }
        });

        await writeLayoutTarget(parsed.target, current, options?.signal);
        return wrapResult("populate_feed_widget", "/", { ok: true, target: parsed.target, harvestedCount: posts.length });
      } catch (err) {
        return wrapError("populate_feed_widget", "/", err);
      }
    }
  }, { signal });

  // 21f. populate_actor_showcase
  void document.modelContext.registerTool({
    name: "populate_actor_showcase",
    description: "Harvest an actor's profile metadata and avatar from Bluesky/Netslum and embed an ActorShowcase card into your page.",
    inputSchema: {
      type: "object",
      required: ["target", "actor"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"] },
        actor: { type: "string", maxLength: 315, description: "Handle or DID of the actor to showcase" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({
          target: z.enum(["homepage", "personal_page"]),
          actor: z.string().max(315)
        }).parse(input);

        const profile = await fetchJson<{ did: string; handle: string; displayName?: string; description?: string; avatar?: string }>(
          `/api/profile/${encodeURIComponent(parsed.actor)}`,
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );

        const current = (await readLayoutTarget(parsed.target, options?.signal)) ?? {
          root: { type: "Box", props: { gap: "large", pad: "large" }, children: [] }
        };
        const root = ("root" in current && typeof current.root === "object" && current.root !== null ? current.root : current) as { type: string; props?: Record<string, unknown>; children?: Array<Record<string, unknown>> };
        if (!Array.isArray(root.children)) root.children = [];

        root.children.push({
          type: "ActorShowcase",
          props: {
            handle: `@${profile.handle}`,
            displayName: profile.displayName ?? profile.handle,
            description: profile.description ?? "",
            avatar: profile.avatar
          }
        });

        await writeLayoutTarget(parsed.target, current, options?.signal);
        return wrapResult("populate_actor_showcase", "/", { ok: true, target: parsed.target, actor: profile.handle });
      } catch (err) {
        return wrapError("populate_actor_showcase", "/", err);
      }
    }
  }, { signal });

  // 21g. populate_zone_portal_widget
  void document.modelContext.registerTool({
    name: "populate_zone_portal_widget",
    description: "Embed an interactive Chaos Gate warp portal card into your page targeting 3 sector keywords.",
    inputSchema: {
      type: "object",
      required: ["target", "prefix", "place", "state"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"] },
        prefix: { type: "string", enum: ["hidden", "burning", "silent", "wandering", "broken", "electric"] },
        place: { type: "string", enum: ["archive", "garden", "cathedral", "market", "labyrinth", "harbor", "forbidden"] },
        state: { type: "string", enum: ["dawn", "echo", "rain", "static", "dream", "void", "holy_ground"] },
        name: { type: "string", maxLength: 100 },
        description: { type: "string", maxLength: 300 }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({
          target: z.enum(["homepage", "personal_page"]),
          prefix: z.enum(["hidden", "burning", "silent", "wandering", "broken", "electric"]),
          place: z.enum(["archive", "garden", "cathedral", "market", "labyrinth", "harbor", "forbidden"]),
          state: z.enum(["dawn", "echo", "rain", "static", "dream", "void", "holy_ground"]),
          name: z.string().max(100).optional(),
          description: z.string().max(300).optional()
        }).parse(input);

        const zoneKey = `${parsed.prefix}.${parsed.place}.${parsed.state}`;
        const current = (await readLayoutTarget(parsed.target, options?.signal)) ?? {
          root: { type: "Box", props: { gap: "large", pad: "large" }, children: [] }
        };
        const root = ("root" in current && typeof current.root === "object" && current.root !== null ? current.root : current) as { type: string; props?: Record<string, unknown>; children?: Array<Record<string, unknown>> };
        if (!Array.isArray(root.children)) root.children = [];

        root.children.push({
          type: "PortalWidget",
          props: {
            name: parsed.name ?? `GATE // ${zoneKey.toUpperCase()}`,
            zoneKey,
            description: parsed.description ?? `Direct portal into sector ${zoneKey}.`
          }
        });

        await writeLayoutTarget(parsed.target, current, options?.signal);
        return wrapResult("populate_zone_portal_widget", "/", { ok: true, target: parsed.target, zoneKey });
      } catch (err) {
        return wrapError("populate_zone_portal_widget", "/", err);
      }
    }
  }, { signal });

  // 21h. clear_ui_page
  void document.modelContext.registerTool({
    name: "clear_ui_page",
    description: "Clear all custom layout components from either your homepage or personal page.",
    inputSchema: {
      type: "object",
      required: ["target"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"] }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ target: z.enum(["homepage", "personal_page"]) }).parse(input);
        await writeLayoutTarget(parsed.target, null, options?.signal);
        return wrapResult("clear_ui_page", "/", { ok: true, target: parsed.target, cleared: true });
      } catch (err) {
        return wrapError("clear_ui_page", "/", err);
      }
    }
  }, { signal });

  // 21i. create_3d_scene
  void document.modelContext.registerTool({
    name: "create_3d_scene",
    description: "Create or initialize a 3D WebGPU scene widget on your homepage or personal page.",
    inputSchema: {
      type: "object",
      required: ["target"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"] },
        title: { type: "string", maxLength: 100, description: "Scene header title" },
        gridFloor: { type: "boolean", description: "Whether to render a cyber grid horizon" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({
          target: z.enum(["homepage", "personal_page"]),
          title: z.string().max(100).optional(),
          gridFloor: z.boolean().optional()
        }).parse(input);

        const current = (await readLayoutTarget(parsed.target, options?.signal)) ?? {
          root: { type: "Box", props: { gap: "large", pad: "large" }, children: [] }
        };
        const root = ("root" in current && typeof current.root === "object" && current.root !== null ? current.root : current) as { type: string; props?: Record<string, unknown>; children?: Array<Record<string, unknown>> };
        if (!Array.isArray(root.children)) root.children = [];

        root.children.push({
          type: "WebGpuWidget",
          props: {
            title: parsed.title ?? "3D CYBER SECTOR MATRIX",
            gridFloor: parsed.gridFloor ?? true,
            objects: []
          }
        });

        await writeLayoutTarget(parsed.target, current, options?.signal);
        return wrapResult("create_3d_scene", "/", { ok: true, target: parsed.target, sceneTitle: parsed.title ?? "3D CYBER SECTOR MATRIX" });
      } catch (err) {
        return wrapError("create_3d_scene", "/", err);
      }
    }
  }, { signal });

  // 21j. add_3d_object
  void document.modelContext.registerTool({
    name: "add_3d_object",
    description: "Add a 3D object mesh (cube, sphere, torus, monolith, portal_ring, pyramid) with custom color and spin animation to a 3D scene.",
    inputSchema: {
      type: "object",
      required: ["target", "type"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"] },
        type: { type: "string", enum: ["cube", "sphere", "torus", "monolith", "portal_ring", "pyramid", "cyber_grid", "particles"] },
        name: { type: "string", maxLength: 50 },
        color: { type: "string", maxLength: 20, description: "Hex color (e.g. '#57E6FF', '#00FF9D', '#B388FF', '#FFB800')" },
        wireframe: { type: "boolean" },
        glow: { type: "boolean" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({
          target: z.enum(["homepage", "personal_page"]),
          type: z.enum(["cube", "sphere", "torus", "monolith", "portal_ring", "pyramid", "cyber_grid", "particles"]),
          name: z.string().max(50).optional(),
          color: z.string().max(20).optional(),
          wireframe: z.boolean().optional(),
          glow: z.boolean().optional()
        }).parse(input);

        const current = (await readLayoutTarget(parsed.target, options?.signal)) ?? {
          root: { type: "Box", props: { gap: "large", pad: "large" }, children: [] }
        };
        const root = ("root" in current && typeof current.root === "object" && current.root !== null ? current.root : current) as { type: string; props?: Record<string, unknown>; children?: Array<Record<string, unknown>> };
        if (!Array.isArray(root.children)) root.children = [];

        // Find existing WebGpuWidget or create one
        let widget = root.children.find((c) => c.type === "WebGpuWidget");
        if (!widget) {
          widget = { type: "WebGpuWidget", props: { title: "3D WEBGPU CYBER SCENE", objects: [] } };
          root.children.push(widget);
        }
        if (!widget.props) widget.props = {};
        if (!Array.isArray(widget.props.objects)) widget.props.objects = [];

        const newObj = {
          id: `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: parsed.type,
          name: parsed.name ?? `${parsed.type.toUpperCase()}_MESH`,
          color: parsed.color ?? "#57E6FF",
          wireframe: parsed.wireframe ?? true,
          glow: parsed.glow ?? true
        };
        (widget.props.objects as Array<Record<string, unknown>>).push(newObj);

        await writeLayoutTarget(parsed.target, current, options?.signal);
        return wrapResult("add_3d_object", "/", { ok: true, target: parsed.target, objectAdded: newObj });
      } catch (err) {
        return wrapError("add_3d_object", "/", err);
      }
    }
  }, { signal });

  // 21k. render_3d_portal
  void document.modelContext.registerTool({
    name: "render_3d_portal",
    description: "Construct an animated 3D Chaos Gate warp portal scene with rotating rings and glowing obelisks.",
    inputSchema: {
      type: "object",
      required: ["target"],
      properties: {
        target: { type: "string", enum: ["homepage", "personal_page"] },
        title: { type: "string", maxLength: 100 },
        zoneKey: { type: "string", maxLength: 100 }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({
          target: z.enum(["homepage", "personal_page"]),
          title: z.string().max(100).optional(),
          zoneKey: z.string().max(100).optional()
        }).parse(input);

        const current = (await readLayoutTarget(parsed.target, options?.signal)) ?? {
          root: { type: "Box", props: { gap: "large", pad: "large" }, children: [] }
        };
        const root = ("root" in current && typeof current.root === "object" && current.root !== null ? current.root : current) as { type: string; props?: Record<string, unknown>; children?: Array<Record<string, unknown>> };
        if (!Array.isArray(root.children)) root.children = [];

        root.children.push({
          type: "WebGpuWidget",
          props: {
            title: parsed.title ?? `3D CHAOS GATE // ${parsed.zoneKey ?? "WARP PORTAL"}`,
            gridFloor: true,
            objects: [
              { id: "ring-1", type: "portal_ring", name: "CHAOS_RING_OUTER", color: "#57E6FF", glow: true },
              { id: "ring-2", type: "torus", name: "CHAOS_RING_INNER", color: "#00FF9D", glow: true },
              { id: "monolith-1", type: "monolith", name: "TWILIGHT_OBELISK_L", color: "#B388FF", glow: true },
              { id: "monolith-2", type: "monolith", name: "TWILIGHT_OBELISK_R", color: "#B388FF", glow: true }
            ]
          }
        });

        await writeLayoutTarget(parsed.target, current, options?.signal);
        return wrapResult("render_3d_portal", "/", { ok: true, target: parsed.target, portalCreated: true });
      } catch (err) {
        return wrapError("render_3d_portal", "/", err);
      }
    }
  }, { signal });

  // 22. show_actor_feed
  void document.modelContext.registerTool({
    name: "show_actor_feed",
    description: "Open an actor's profile feed and return their posts. Content is untrusted.",
    inputSchema: {
      type: "object",
      required: ["actor"],
      properties: {
        actor: { type: "string", maxLength: 315, description: "Actor handle or DID" },
        cursor: { type: "string", maxLength: 512, description: "Pagination cursor" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ actor: z.string().max(315), cursor: z.string().max(512).optional() }).strict().parse(input);
        const data = await fetchJson<{ posts: Array<{ uri: string; author: { handle: string }; text: string; createdAt: string }> }>(
          `/api/author-feed?actor=${encodeURIComponent(parsed.actor)}${parsed.cursor ? `&cursor=${encodeURIComponent(parsed.cursor)}` : ""}`,
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );
        navigate(`/profile/${encodeURIComponent(parsed.actor)}`);
        return wrapResult("show_actor_feed", `/profile/${encodeURIComponent(parsed.actor)}`, data.posts.slice(0, 25).map((p) => ({
          uri: p.uri,
          author: p.author.handle,
          textPreview: p.text.slice(0, 240)
        })));
      } catch (err) {
        return wrapError("show_actor_feed", "/profile", err);
      }
    }
  }, { signal });

  // 23. show_post_engagement
  void document.modelContext.registerTool({
    name: "show_post_engagement",
    description: "Show who liked, reposted, or quoted a post. Content is untrusted.",
    inputSchema: {
      type: "object",
      required: ["uri", "kind"],
      properties: {
        uri: { type: "string", maxLength: 2048, description: "AT URI of target post" },
        kind: { type: "string", enum: ["likes", "reposts", "quotes"], description: "Engagement type" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ uri: z.string().max(2048), kind: z.enum(["likes", "reposts", "quotes"]) }).strict().parse(input);
        const data = await fetchJson<{ actors: Array<{ did: string; handle: string }> }>(
          `/api/post-engagement?uri=${encodeURIComponent(parsed.uri)}&kind=${parsed.kind}`,
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );
        return wrapResult("show_post_engagement", "/post", { kind: parsed.kind, actors: data.actors.slice(0, 25).map((a) => a.handle) });
      } catch (err) {
        return wrapError("show_post_engagement", "/post", err);
      }
    }
  }, { signal });

  // 24. list_saved_feeds
  void document.modelContext.registerTool({
    name: "list_saved_feeds",
    description: "List your saved Bluesky feeds.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
      required: []
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        void input;
        const data = await fetchJson<{ feeds: Array<Record<string, unknown>> }>(
          "/api/feeds/saved",
          { ...(options?.signal ? { signal: options.signal } : {}) }
        );
        return wrapResult("list_saved_feeds", "/feeds", data.feeds.slice(0, 25).map((f) => ({
          uri: typeof f.uri === "string" ? f.uri : "",
          pinned: Boolean(f.pinned)
        })));
      } catch (err) {
        return wrapError("list_saved_feeds", "/feeds", err);
      }
    }
  }, { signal });

  // 25. set_saved_feed
  void document.modelContext.registerTool({
    name: "set_saved_feed",
    description: "Save or remove a Bluesky feed generator by URI. Durable effect on your preferences.",
    inputSchema: {
      type: "object",
      required: ["uri", "save"],
      properties: {
        uri: { type: "string", maxLength: 2048, description: "AT URI of feed generator" },
        cid: { type: "string", maxLength: 200, description: "Optional CID of feed generator" },
        save: { type: "boolean", description: "True to save/pin, false to remove" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ uri: z.string().max(2048), cid: z.string().max(200).optional(), save: z.boolean() }).strict().parse(input);
        const data = await fetchJson<{ saved: boolean }>(parsed.save ? "/api/feeds/saved" : `/api/feeds/saved?uri=${encodeURIComponent(parsed.uri)}`, {
          ...(parsed.save ? {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify({ uri: parsed.uri, ...(parsed.cid ? { cid: parsed.cid } : {}) })
          } : { method: "DELETE" }),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("set_saved_feed", "/feeds", data);
      } catch (err) {
        return wrapError("set_saved_feed", "/feeds", err);
      }
    }
  }, { signal });

  // 26. update_profile
  void document.modelContext.registerTool({
    name: "update_profile",
    description: "Update your display name or description. Durable effect on your profile record.",
    inputSchema: {
      type: "object",
      properties: {
        displayName: { type: "string", maxLength: 640, description: "New display name" },
        description: { type: "string", maxLength: 2560, description: "New profile bio/description" }
      },
      additionalProperties: false,
      required: []
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ displayName: z.string().max(640).optional(), description: z.string().max(2560).optional() }).strict().parse(input);
        const data = await fetchJson<{ updated: boolean }>("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed),
          ...(options?.signal ? { signal: options.signal } : {})
        });
        return wrapResult("update_profile", "/settings/profile", data);
      } catch (err) {
        return wrapError("update_profile", "/settings/profile", err);
      }
    }
  }, { signal });

  // 27. open_personal_site
  void document.modelContext.registerTool({
    name: "open_personal_site",
    description: "Open an actor's published personal site by slug.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string", maxLength: 64, description: "Personal site slug" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: (input: unknown) => {
      try {
        const parsed = z.object({ slug: z.string().max(64) }).strict().parse(input);
        navigate(`/@${parsed.slug}`);
        return wrapResult("open_personal_site", `/@${parsed.slug}`, { slug: parsed.slug });
      } catch (err) {
        return wrapError("open_personal_site", "/", err);
      }
    }
  }, { signal });

  // 28. show_district
  void document.modelContext.registerTool({
    name: "show_district",
    description: "Open and inspect the active district experience for a personal site slug.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string", maxLength: 64, description: "Personal site slug" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: (input: unknown) => {
      try {
        const parsed = z.object({ slug: z.string().max(64) }).strict().parse(input);
        const route = `/district/${encodeURIComponent(parsed.slug)}`;
        navigate(route);
        return wrapResult("show_district", route, { slug: parsed.slug, url: route });
      } catch (err) {
        return wrapError("show_district", "/", err);
      }
    }
  }, { signal });

  // ------------------------------------------------------------------
  // Site Publisher tools: registered ONLY when session.canPublishSite is true.
  // ------------------------------------------------------------------
  if (session.canPublishSite === true) {
    // 29. open_site_editor
    void document.modelContext.registerTool({
      name: "open_site_editor",
      description: "Open the Studio editor and inspect draft files.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
        required: []
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          void input;
          navigate("/studio");
          const data = await fetchJson<SiteDraftRes>("/api/sites/draft", { ...(options?.signal ? { signal: options.signal } : {}) });
          const summaries = data.files.slice(0, 12).map((f) => ({ path: f.path, size: f.size, mimeType: f.mimeType }));
          return wrapResult("open_site_editor", "/studio", {
            slug: data.slug,
            revision: data.revision,
            files: summaries,
            truncated: data.files.length > 12
          });
        } catch (err) {
          return wrapError("open_site_editor", "/studio", err);
        }
      }
    }, { signal });

    // 30. read_site_file
    void document.modelContext.registerTool({
      name: "read_site_file",
      description: "Read a chunk of a site file in the current draft.",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", maxLength: 128, description: "Draft file path" },
          offset: { type: "integer", minimum: 0, description: "Read character offset" },
          maxChars: { type: "integer", minimum: 1, maximum: 1000, description: "Maximum characters to read" }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = readSiteFileSchema.parse(input);
          const url = `/api/sites/file?path=${encodeURIComponent(parsed.path)}&offset=${parsed.offset}&maxChars=${parsed.maxChars}`;
          const data = await fetchJson<SiteFileRes>(url, { ...(options?.signal ? { signal: options.signal } : {}) });
          return wrapResult("read_site_file", "/studio", data);
        } catch (err) {
          return wrapError("read_site_file", "/studio", err);
        }
      }
    }, { signal });

    // 31. save_site_file
    void document.modelContext.registerTool({
      name: "save_site_file",
      description: "Save a file in the draft workspace up to 64 KiB.",
      inputSchema: {
        type: "object",
        required: ["path", "content", "encoding", "contentType", "expectedRevision"],
        properties: {
          path: { type: "string", maxLength: 128, description: "Draft file path" },
          content: { type: "string", maxLength: 65536, description: "File content payload" },
          encoding: { type: "string", enum: ["utf8", "base64"], description: "Encoding of content payload" },
          contentType: { type: "string", description: "MIME content type" },
          expectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$", description: "Expected draft revision hash" }
        },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = saveSiteFileSchema.parse(input);
          const data = await fetchJson<SaveSiteFileRes>("/api/sites/file", {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify(parsed),
            ...(options?.signal ? { signal: options.signal } : {})
          });
          return wrapResult("save_site_file", "/studio", {
            path: parsed.path,
            revision: data.revision,
            size: data.size,
            sha256: data.sha256
          });
        } catch (err) {
          return wrapError("save_site_file", "/studio", err);
        }
      }
    }, { signal });

    // 32. delete_site_file
    void document.modelContext.registerTool({
      name: "delete_site_file",
      description: "Delete a non-index.html file from the site draft.",
      inputSchema: {
        type: "object",
        required: ["path", "expectedRevision"],
        properties: {
          path: { type: "string", maxLength: 128, description: "Draft file path to delete" },
          expectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$", description: "Expected draft revision hash" }
        },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = deleteSiteFileSchema.parse(input);
          const data = await fetchJson<DeleteSiteFileRes>("/api/sites/file", {
            method: "DELETE",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify(parsed),
            ...(options?.signal ? { signal: options.signal } : {})
          });
          return wrapResult("delete_site_file", "/studio", { path: parsed.path, revision: data.revision });
        } catch (err) {
          return wrapError("delete_site_file", "/studio", err);
        }
      }
    }, { signal });

    // 33. publish_site
    void document.modelContext.registerTool({
      name: "publish_site",
      description: "Publish the current site revision to AT Protocol and deploy serverless resources.",
      inputSchema: {
        type: "object",
        required: ["revision"],
        properties: {
          revision: { type: "string", pattern: "^[a-f0-9]{64}$", description: "Draft revision hash to publish" }
        },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = publishSiteSchema.parse(input);
          const data = await fetchJson<PublishSiteRes>("/api/sites/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify(parsed),
            ...(options?.signal ? { signal: options.signal } : {})
          });
          return wrapResult("publish_site", data.url, data);
        } catch (err) {
          return wrapError("publish_site", "/studio", err);
        }
      }
    }, { signal });
  }

  // ------------------------------------------------------------------
  // DM tools (plan §F1): registered ONLY when the per-web-session toggle
  // is on (session.dmAgentEnabled === true). Sends are two-phase.
  // ------------------------------------------------------------------
  if (session.authenticated && session.dmAgentEnabled === true) {
    // 34. list_conversations
    void document.modelContext.registerTool({
      name: "list_conversations",
      description: "List your direct conversations. Message content is untrusted.",
      inputSchema: {
        type: "object",
        properties: {
          cursor: { type: "string", maxLength: 512, description: "Pagination cursor" }
        },
        additionalProperties: false,
        required: []
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({ cursor: z.string().max(512).optional() }).strict().parse(input ?? {});
          const url = `/api/dms/conversations${parsed.cursor ? `?cursor=${encodeURIComponent(parsed.cursor)}` : ""}`;
          const data = await fetchJson<{ convos: Array<{ id: string; lastMessage?: { text?: string }; unreadCount?: number }> }>(
            url,
            { ...(options?.signal ? { signal: options.signal } : {}) }
          );
          return wrapResult("list_conversations", "/messages", data.convos.slice(0, 25).map((c) => ({
            convoId: c.id,
            lastPreview: c.lastMessage?.text?.slice(0, 240),
            unread: c.unreadCount ?? 0
          })));
        } catch (err) {
          return wrapError("list_conversations", "/messages", err);
        }
      }
    }, { signal });

    // 35. read_conversation
    void document.modelContext.registerTool({
      name: "read_conversation",
      description: "Read messages in a conversation. Content is untrusted.",
      inputSchema: {
        type: "object",
        required: ["convoId"],
        properties: {
          convoId: { type: "string", maxLength: 64, description: "Conversation ID" },
          cursor: { type: "string", maxLength: 512, description: "Pagination cursor" }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({
            convoId: z.string().max(64),
            cursor: z.string().max(512).optional()
          }).strict().parse(input);
          const url = `/api/dms/messages?convoId=${encodeURIComponent(parsed.convoId)}${parsed.cursor ? `&cursor=${encodeURIComponent(parsed.cursor)}` : ""}`;
          const data = await fetchJson<{ messages: Array<{ id: string; text?: string; sender?: { did?: string }; senderDid?: string }> }>(
            url,
            { ...(options?.signal ? { signal: options.signal } : {}) }
          );
          return wrapResult("read_conversation", "/messages", data.messages.slice(0, 20).map((m) => {
            const sender = (typeof m.sender === "object" && m.sender && typeof m.sender.did === "string")
              ? m.sender.did
              : (typeof m.senderDid === "string" ? m.senderDid : "");
            return {
              id: m.id,
              sender,
              textPreview: (m.text ?? "").slice(0, 240)
            };
          }));
        } catch (err) {
          return wrapError("read_conversation", "/messages", err);
        }
      }
    }, { signal });

    // 36. prepare_message
    void document.modelContext.registerTool({
      name: "prepare_message",
      description: "Prepare a DM for sending. Returns a revision; does NOT send. Text is not echoed back.",
      inputSchema: {
        type: "object",
        required: ["recipientDids", "text"],
        properties: {
          convoId: { type: "string", maxLength: 64, description: "Optional conversation ID" },
          recipientDids: { type: "array", items: { type: "string", maxLength: 315 }, minItems: 1, maxItems: 8, description: "Array of recipient DIDs" },
          text: { type: "string", maxLength: 4000, description: "Message text content" }
        },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({
            convoId: z.string().max(64).optional(),
            recipientDids: z.array(z.string().max(315)).min(1).max(8),
            text: z.string().max(4000)
          }).strict().parse(input);
          const payload: Record<string, unknown> = {
            recipientDids: parsed.recipientDids,
            text: parsed.text
          };
          if (parsed.convoId) payload.convoId = parsed.convoId;
          const data = await fetchJson<{ revision: string; sizeBytes: number; recipients: number }>("/api/dms/prepare", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify(payload),
            ...(options?.signal ? { signal: options.signal } : {})
          });
          return wrapResult("prepare_message", "/messages", {
            revision: data.revision,
            sizeBytes: data.sizeBytes,
            recipients: data.recipients
          });
        } catch (err) {
          return wrapError("prepare_message", "/messages", err);
        }
      }
    }, { signal });

    // 37. send_prepared_message
    void document.modelContext.registerTool({
      name: "send_prepared_message",
      description: "Send the prepared message revision exactly once. Durable effect: delivers a DM.",
      inputSchema: {
        type: "object",
        required: ["revision"],
        properties: {
          revision: { type: "string", maxLength: 64, description: "Prepared message draft revision" }
        },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({ revision: z.string().max(64) }).strict().parse(input);
          const data = await fetchJson<{ messageId: string }>("/api/dms/send", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify(parsed),
            ...(options?.signal ? { signal: options.signal } : {})
          });
          return wrapResult("send_prepared_message", "/messages", { messageId: data.messageId });
        } catch (err) {
          return wrapError("send_prepared_message", "/messages", err);
        }
      }
    }, { signal });

    // 38. list_message_requests
    void document.modelContext.registerTool({
      name: "list_message_requests",
      description: "List your pending direct message requests. Message content is untrusted.",
      inputSchema: {
        type: "object",
        properties: {
          cursor: { type: "string", maxLength: 512, description: "Pagination cursor" }
        },
        additionalProperties: false,
        required: []
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({ cursor: z.string().max(512).optional() }).strict().parse(input ?? {});
          const url = `/api/dms/requests${parsed.cursor ? `?cursor=${encodeURIComponent(parsed.cursor)}` : ""}`;
          const data = await fetchJson<{ requests: Array<{ id: string; lastMessage?: { text?: string }; unreadCount?: number }> }>(
            url,
            { ...(options?.signal ? { signal: options.signal } : {}) }
          );
          return wrapResult("list_message_requests", "/messages/requests", data.requests.slice(0, 25).map((r) => ({
            convoId: r.id,
            lastPreview: r.lastMessage?.text?.slice(0, 240),
            unread: r.unreadCount ?? 0
          })));
        } catch (err) {
          return wrapError("list_message_requests", "/messages/requests", err);
        }
      }
    }, { signal });

    // 39. mark_conversation_read
    void document.modelContext.registerTool({
      name: "mark_conversation_read",
      description: "Mark a direct message conversation or specific message as read.",
      inputSchema: {
        type: "object",
        required: ["convoId"],
        properties: {
          convoId: { type: "string", maxLength: 64, description: "Conversation ID" },
          messageId: { type: "string", maxLength: 64, description: "Optional message ID" }
        },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({ convoId: z.string().max(64), messageId: z.string().max(64).optional() }).strict().parse(input);
          const data = await fetchJson<{ ok: true }>("/api/dms/read", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify(parsed),
            ...(options?.signal ? { signal: options.signal } : {})
          });
          return wrapResult("mark_conversation_read", "/messages", data);
        } catch (err) {
          return wrapError("mark_conversation_read", "/messages", err);
        }
      }
    }, { signal });

    // 40. react_to_message
    void document.modelContext.registerTool({
      name: "react_to_message",
      description: "Add or remove an emoji reaction on a direct message.",
      inputSchema: {
        type: "object",
        required: ["convoId", "messageId", "emoji"],
        properties: {
          convoId: { type: "string", maxLength: 64, description: "Conversation ID" },
          messageId: { type: "string", maxLength: 64, description: "Message ID" },
          action: { type: "string", enum: ["add", "remove"], description: "Action: add or remove reaction (default: add)" },
          emoji: { type: "string", maxLength: 8, description: "Single emoji character" }
        },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({
            convoId: z.string().max(64),
            messageId: z.string().max(64),
            action: z.enum(["add", "remove"]).optional(),
            emoji: z.string().max(8)
          }).strict().parse(input);
          const remove = parsed.action === "remove";
          const data = await fetchJson<{ ok: boolean }>("/api/dms/react", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify({
              convoId: parsed.convoId,
              messageId: parsed.messageId,
              value: parsed.emoji,
              remove
            }),
            ...(options?.signal ? { signal: options.signal } : {})
          });
          return wrapResult("react_to_message", "/messages", data);
        } catch (err) {
          return wrapError("react_to_message", "/messages", err);
        }
      }
    }, { signal });

    // 41. delete_message_for_self
    void document.modelContext.registerTool({
      name: "delete_message_for_self",
      description: "Delete a message from a direct conversation for yourself.",
      inputSchema: {
        type: "object",
        required: ["convoId", "messageId"],
        properties: {
          convoId: { type: "string", maxLength: 64, description: "Conversation ID" },
          messageId: { type: "string", maxLength: 64, description: "Message ID" }
        },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({
            convoId: z.string().max(64),
            messageId: z.string().max(64)
          }).strict().parse(input);
          const data = await fetchJson<{ ok: boolean }>("/api/dms/delete-for-self", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify(parsed),
            ...(options?.signal ? { signal: options.signal } : {})
          });
          return wrapResult("delete_message_for_self", "/messages", data);
        } catch (err) {
          return wrapError("delete_message_for_self", "/messages", err);
        }
      }
    }, { signal });
  }
}
