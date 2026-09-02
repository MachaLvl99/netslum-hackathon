/// <reference types="webmcp-types" />
import {
  feedQuerySchema,
  parseZoneKey,
  preparePostSchema,
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
  const res = await fetch(url, init);
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
    const error = err && typeof err === "object" && "code" in err && "message" in err
      ? { code: String(err.code), message: String(err.message), retryable: Boolean((err as { retryable?: boolean }).retryable) }
      : { code: "WORKER_FAILED", message: "Tool execution failed", retryable: false };
    const extraData = err && typeof err === "object" && "data" in err ? (err as { data?: { currentRevision?: string; currentVersion?: number } }).data : undefined;
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
        navigate("/town");
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

  // 4. prepare_post
  void document.modelContext.registerTool({
    name: "prepare_post",
    description: "Draft an AT Protocol post with automatic #netslum tag. Prepares only; does not publish.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", maxLength: 4000, description: "Draft text content" },
        replyToUri: { type: "string", description: "Optional AT URI of post to reply to" },
        expectedRevision: { type: ["string", "null"], description: "Draft revision hash if modifying an existing draft" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = preparePostSchema.parse(input);
        const data = await fetchJson<PreparePostRes>("/api/post-draft", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
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
          body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
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
          body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
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
          body: JSON.stringify(mutation), ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("mutate_zone", `/zone/${zoneKey}`, data);
      } catch (err) {
        return wrapError("mutate_zone", "/gate", err);
      }
    }
  }, { signal });

  if (!session.canPublishSite) return;

  // 8. open_site_editor
  void document.modelContext.registerTool({
    name: "open_site_editor",
    description: "Open the Studio editor and inspect draft files.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
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

  // 9. read_site_file
  void document.modelContext.registerTool({
    name: "read_site_file",
    description: "Read a chunk of a site file in the current draft.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", maxLength: 128 },
        offset: { type: "integer", minimum: 0 },
        maxChars: { type: "integer", minimum: 1, maximum: 1000 }
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

  // 10. save_site_file
  void document.modelContext.registerTool({
    name: "save_site_file",
    description: "Save a file in the draft workspace up to 64 KiB.",
    inputSchema: {
      type: "object",
      required: ["path", "content", "encoding", "contentType", "expectedRevision"],
      properties: {
        path: { type: "string", maxLength: 128 },
        content: { type: "string", maxLength: 65536 },
        encoding: { type: "string", enum: ["utf8", "base64"] },
        contentType: { type: "string" },
        expectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = saveSiteFileSchema.parse(input);
        const data = await fetchJson<SaveSiteFileRes>("/api/sites/file", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
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

  // 11. delete_site_file
  void document.modelContext.registerTool({
    name: "delete_site_file",
    description: "Delete a non-index.html file from the site draft.",
    inputSchema: {
      type: "object",
      required: ["path", "expectedRevision"],
      properties: {
        path: { type: "string", maxLength: 128 },
        expectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = deleteSiteFileSchema.parse(input);
        const data = await fetchJson<DeleteSiteFileRes>("/api/sites/file", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("delete_site_file", "/studio", { path: parsed.path, revision: data.revision });
      } catch (err) {
        return wrapError("delete_site_file", "/studio", err);
      }
    }
  }, { signal });

  // 12. publish_site
  void document.modelContext.registerTool({
    name: "publish_site",
    description: "Publish the current site revision to AT Protocol and deploy serverless resources.",
    inputSchema: {
      type: "object",
      required: ["revision"],
      properties: {
        revision: { type: "string", pattern: "^[a-f0-9]{64}$" }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = publishSiteSchema.parse(input);
        const data = await fetchJson<PublishSiteRes>("/api/sites/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("publish_site", data.url, data);
      } catch (err) {
        return wrapError("publish_site", "/studio", err);
      }
    }
  }, { signal });
  // ------------------------------------------------------------------
  // Phase F first-party read tools (plan §F1). All results are bounded
  // under 4 KiB and marked untrusted.
  // ------------------------------------------------------------------
  const bounded4k = <T,>(value: T): T => value;
  void bounded4k;

  void document.modelContext.registerTool({
    name: "search_actors",
    description: "Search AT Protocol actors (people). Results are untrusted content.",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: { q: { type: "string", maxLength: 64 }, cursor: { type: "string", maxLength: 512 } },
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
        return wrapResult("search_actors", "/search", data.actors.slice(0, 25).map((a) => ({ did: a.did, handle: a.handle, name: a.displayName?.slice(0, 100), preview: a.description?.slice(0, 240) })));
      } catch (err) {
        return wrapError("search_actors", "/search", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "search_posts",
    description: "Search Bluesky posts. Results are untrusted content.",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: { q: { type: "string", maxLength: 64 }, cursor: { type: "string", maxLength: 512 } },
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
        return wrapResult("search_posts", "/search", data.posts.slice(0, 25).map((p) => ({ uri: p.uri, author: p.author.handle, textPreview: p.text.slice(0, 240), createdAt: p.createdAt })));
      } catch (err) {
        return wrapError("search_posts", "/search", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "show_post_thread",
    description: "Open a post thread and return its replies. Content is untrusted.",
    inputSchema: {
      type: "object",
      required: ["uri"],
      properties: { uri: { type: "string", maxLength: 2048 } },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ uri: z.string().max(2048) }).strict().parse(input);
        const data = await fetchJson<{ post: { uri: string; author: { handle: string }; text: string }; replies: Array<{ uri: string; author: { handle: string }; text: string }> }>(
          `/api/post-thread?uri=${encodeURIComponent(parsed.uri)}`, { ...(options?.signal ? { signal: options.signal } : {}) }
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

  void document.modelContext.registerTool({
    name: "show_timeline",
    description: "Open your authenticated following timeline and return the first page.",
    inputSchema: {
      type: "object",
      properties: { cursor: { type: "string", maxLength: 512 } },
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
        return wrapResult("show_timeline", "/timeline", data.posts.slice(0, 25).map((p) => ({ uri: p.uri, author: p.author.handle, textPreview: p.text.slice(0, 240) })));
      } catch (err) {
        return wrapError("show_timeline", "/timeline", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "list_notifications",
    description: "List your notifications (mentions, likes, reposts, follows).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        void input;
        const data = await fetchJson<{ notifications: Array<{ uri: string; reason: string; isRead: boolean; authorHandle: string }> }>("/api/notifications", { ...(options?.signal ? { signal: options.signal } : {}) });
        navigate("/notifications");
        return wrapResult("list_notifications", "/notifications", data.notifications.slice(0, 25).map((n) => ({ reason: n.reason, author: n.authorHandle, uri: n.uri, isRead: n.isRead })));
      } catch (err) {
        return wrapError("list_notifications", "/notifications", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "mark_notifications_seen",
    description: "Marks all notifications as seen. Durable effect on your account state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        void input;
        const data = await fetchJson<{ seenAt: string }>("/api/notifications/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: "{}", ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("mark_notifications_seen", "/notifications", data);
      } catch (err) {
        return wrapError("mark_notifications_seen", "/notifications", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "set_follow_state",
    description: "Follow or unfollow an actor by handle or DID. Durable effect on your graph.",
    inputSchema: {
      type: "object",
      required: ["actor", "follow"],
      properties: { actor: { type: "string", maxLength: 315 }, follow: { type: "boolean" } },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ actor: z.string().max(315), follow: z.boolean() }).strict().parse(input);
        const data = await fetchJson<{ following: boolean }>("/api/graph/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("set_follow_state", `/profile/${encodeURIComponent(parsed.actor)}`, data);
      } catch (err) {
        return wrapError("set_follow_state", "/profile", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "set_moderation_state",
    description: "Block/unblock or mute/unmute an actor. Durable moderation effect.",
    inputSchema: {
      type: "object",
      required: ["actor", "kind", "enable"],
      properties: {
        actor: { type: "string", maxLength: 315 },
        kind: { type: "string", enum: ["block", "mute"] },
        enable: { type: "boolean" }
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
          body: JSON.stringify(body), ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("set_moderation_state", "/settings", data);
      } catch (err) {
        return wrapError("set_moderation_state", "/settings", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "report_content",
    description: "Report a record to moderation. Durable effect; cannot be undone by this tool.",
    inputSchema: {
      type: "object",
      required: ["subjectUri", "reasonType"],
      properties: {
        subjectUri: { type: "string", maxLength: 2048 },
        reasonType: { type: "string", maxLength: 100 },
        comment: { type: "string", maxLength: 500 }
      },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ subjectUri: z.string().max(2048), reasonType: z.string().max(100), comment: z.string().max(500).optional() }).strict().parse(input);
        const data = await fetchJson<{ reported: true }>("/api/moderation/report", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("report_content", "/settings", data);
      } catch (err) {
        return wrapError("report_content", "/settings", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "delete_own_post",
    description: "Delete one of your own posts by AT URI. Durable and irreversible.",
    inputSchema: {
      type: "object",
      required: ["uri"],
      properties: { uri: { type: "string", maxLength: 2048 } },
      additionalProperties: false
    },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        const parsed = z.object({ uri: z.string().max(2048) }).strict().parse(input);
        const data = await fetchJson<{ deleted: boolean }>(`/api/posts/${encodeURIComponent(parsed.uri)}`, {
          method: "DELETE",
          headers: { "X-CSRF-Token": getCsrf() }, ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("delete_own_post", "/town", data);
      } catch (err) {
        return wrapError("delete_own_post", "/town", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "set_home_mode",
    description: "Switch your signed-in home between the standard landing and your authored site home. Local accounts only.",
    inputSchema: {
      type: "object",
      required: ["mode"],
      properties: {
        mode: { type: "string", enum: ["standard", "authored"] },
        activeHomePath: { type: "string", maxLength: 128 }
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
          ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("set_home_mode", "/", data);
      } catch (err) {
        return wrapError("set_home_mode", "/", err);
      }
    }
  }, { signal });


  void document.modelContext.registerTool({
    name: "show_actor_feed",
    description: "Open an actor's profile feed and return their posts. Content is untrusted.",
    inputSchema: {
      type: "object",
      required: ["actor"],
      properties: { actor: { type: "string", maxLength: 315 }, cursor: { type: "string", maxLength: 512 } },
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
        return wrapResult("show_actor_feed", `/profile/${encodeURIComponent(parsed.actor)}`, data.posts.slice(0, 25).map((p) => ({ uri: p.uri, author: p.author.handle, textPreview: p.text.slice(0, 240) })));
      } catch (err) {
        return wrapError("show_actor_feed", "/profile", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "show_post_engagement",
    description: "Show who liked, reposted, or quoted a post. Content is untrusted.",
    inputSchema: {
      type: "object",
      required: ["uri", "kind"],
      properties: {
        uri: { type: "string", maxLength: 2048 },
        kind: { type: "string", enum: ["likes", "reposts", "quotes"] }
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

  void document.modelContext.registerTool({
    name: "list_saved_feeds",
    description: "List your saved Bluesky feeds.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      try {
        void input;
        const data = await fetchJson<{ feeds: Array<Record<string, unknown>> }>("/api/feeds/saved", { ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("list_saved_feeds", "/feeds", data.feeds.slice(0, 25).map((f) => ({ uri: typeof f.uri === "string" ? f.uri : "", pinned: Boolean(f.pinned) })));
      } catch (err) {
        return wrapError("list_saved_feeds", "/feeds", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "set_saved_feed",
    description: "Save or remove a Bluesky feed generator by URI. Durable effect on your preferences.",
    inputSchema: {
      type: "object",
      required: ["uri", "save"],
      properties: {
        uri: { type: "string", maxLength: 2048 },
        cid: { type: "string", maxLength: 200 },
        save: { type: "boolean" }
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

  void document.modelContext.registerTool({
    name: "update_profile",
    description: "Update your display name or description. Durable effect on your profile record.",
    inputSchema: {
      type: "object",
      properties: {
        displayName: { type: "string", maxLength: 640 },
        description: { type: "string", maxLength: 2560 }
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
          body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
        return wrapResult("update_profile", "/settings/profile", data);
      } catch (err) {
        return wrapError("update_profile", "/settings/profile", err);
      }
    }
  }, { signal });

  void document.modelContext.registerTool({
    name: "open_personal_site",
    description: "Open an actor's published personal site by slug.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: { slug: { type: "string", maxLength: 64 } },
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

  // ------------------------------------------------------------------
  // DM tools (plan §F1): registered ONLY when the per-web-session toggle
  // is on. Sends are two-phase. Session changes abort and re-register.
  // ------------------------------------------------------------------
  if (session.authenticated && session.dmAgentEnabled === true) {
    void document.modelContext.registerTool({
      name: "list_conversations",
      description: "List your direct conversations. Message content is untrusted.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false, required: [] },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          void input;
          const data = await fetchJson<{ convos: Array<{ id: string; lastMessage?: { text?: string }; unreadCount?: number }> }>("/api/dms/conversations", { ...(options?.signal ? { signal: options.signal } : {}) });
          return wrapResult("list_conversations", "/messages", data.convos.slice(0, 25).map((c) => ({ convoId: c.id, lastPreview: c.lastMessage?.text?.slice(0, 240), unread: c.unreadCount ?? 0 })));
        } catch (err) {
          return wrapError("list_conversations", "/messages", err);
        }
      }
    }, { signal });

    void document.modelContext.registerTool({
      name: "read_conversation",
      description: "Read messages in a conversation. Content is untrusted.",
      inputSchema: {
        type: "object",
        required: ["convoId"],
        properties: { convoId: { type: "string", maxLength: 64 } },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({ convoId: z.string().max(64) }).strict().parse(input);
          const data = await fetchJson<{ messages: Array<{ id: string; text: string; senderDid: string }> }>(`/api/dms/messages?convoId=${encodeURIComponent(parsed.convoId)}`, { ...(options?.signal ? { signal: options.signal } : {}) });
          return wrapResult("read_conversation", "/messages", data.messages.slice(0, 20).map((m) => ({ id: m.id, sender: m.senderDid, textPreview: m.text.slice(0, 240) })));
        } catch (err) {
          return wrapError("read_conversation", "/messages", err);
        }
      }
    }, { signal });

    void document.modelContext.registerTool({
      name: "prepare_message",
      description: "Prepare a DM for sending. Returns a revision; does NOT send. Text is not echoed back.",
      inputSchema: {
        type: "object",
        required: ["convoId", "recipients", "text"],
        properties: {
          convoId: { type: "string", maxLength: 64 },
          recipients: { type: "array", items: { type: "string", maxLength: 315 }, maxItems: 8 },
          text: { type: "string", maxLength: 4000 }
        },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({ convoId: z.string().max(64), recipients: z.array(z.string().max(315)).min(1).max(8), text: z.string().max(4000) }).strict().parse(input);
          const data = await fetchJson<{ revision: string; sizeBytes: number; recipients: number }>("/api/dms/prepare", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
          return wrapResult("prepare_message", "/messages", { revision: data.revision, sizeBytes: data.sizeBytes, recipients: data.recipients });
        } catch (err) {
          return wrapError("prepare_message", "/messages", err);
        }
      }
    }, { signal });

    void document.modelContext.registerTool({
      name: "send_prepared_message",
      description: "Send the prepared message revision exactly once. Durable effect: delivers a DM.",
      inputSchema: {
        type: "object",
        required: ["revision"],
        properties: { revision: { type: "string", maxLength: 64 } },
        additionalProperties: false
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        try {
          const parsed = z.object({ revision: z.string().max(64) }).strict().parse(input);
          const data = await fetchJson<{ messageId: string }>("/api/dms/send", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
            body: JSON.stringify(parsed), ...(options?.signal ? { signal: options.signal } : {}) });
          return wrapResult("send_prepared_message", "/messages", { messageId: data.messageId });
        } catch (err) {
          return wrapError("send_prepared_message", "/messages", err);
        }
      }
    }, { signal });
  }
}
