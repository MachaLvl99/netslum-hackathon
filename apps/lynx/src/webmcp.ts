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
  canPublishSite?: boolean;
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
}
