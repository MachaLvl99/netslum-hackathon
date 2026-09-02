import { z } from "zod";
import { revisionSchema } from "./sites.js";

// Phase 2 contract schemas (plan §B1). Named types and strict Zod schemas for
// capabilities, profiles, posts/embeds, feeds, search, notifications, graph
// actions, media uploads/jobs, DM summaries/messages/drafts, home settings,
// districts, trusted action requests, and tenant tool manifests. No
// `ReturnType<typeof fn>` contract types.

export const LOCAL_PDS_SUFFIX = ".pds.netslum.macha.sh";

// ---------------------------------------------------------------------------
// Identity helpers (plan §B2, §B3)
// ---------------------------------------------------------------------------

export const didSchema = z.string().regex(/^did:[a-z]+:[A-Za-z0-9._:%-]+$/).max(255);
export const handleSchema = z.string().regex(/^[a-zA-Z0-9.-]*[a-zA-Z0-9](?:\.[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/).max(315);

/**
 * Resolves user-provided actor input to a canonical identifier.
 * - a bare single label (`alice`) means `alice.pds.netslum.macha.sh`
 * - values containing `.` or DIDs remain global identifiers
 * Canonical DIDs remain the storage/auth keys everywhere else.
 */
export function normalizeActorInput(input: string): string {
  const trimmed = input.trim().replace(/^@/, "");
  if (didSchema.safeParse(trimmed).success) return trimmed;
  if (trimmed.includes(".")) return trimmed.toLowerCase();
  return `${trimmed.toLowerCase()}${LOCAL_PDS_SUFFIX}`;
}

/**
 * Presents a handle for display.
 * - the exact verified local handle `alice.pds.netslum.macha.sh` displays `@alice`
 * - every other handle displays fully
 */
export function presentHandle(handle: string): string {
  if (handle.endsWith(LOCAL_PDS_SUFFIX)) {
    const label = handle.slice(0, -LOCAL_PDS_SUFFIX.length);
    if (label.length > 0 && !label.includes(".")) return `@${label}`;
  }
  return handle;
}

// ---------------------------------------------------------------------------
// Capabilities (session-derived)
// ---------------------------------------------------------------------------

export const capabilitiesSchema = z.object({
  canPublishSite: z.boolean(),
  canAuthorHome: z.boolean(),
  canUseDms: z.boolean(),
  dmAgentEnabled: z.boolean(),
  canUploadVideo: z.boolean(),
  reauthorizeRequired: z.boolean()
}).strict();
export type Capabilities = z.infer<typeof capabilitiesSchema>;

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  did: didSchema,
  handle: z.string(),
  displayName: z.string().max(640).optional(),
  description: z.string().max(2560).optional(),
  avatar: z.string().max(2048).optional(),
  banner: z.string().max(2048).optional(),
  followersCount: z.number().int().nonnegative().optional(),
  followsCount: z.number().int().nonnegative().optional(),
  postsCount: z.number().int().nonnegative().optional(),
  siteSlug: z.string().optional(),
  viewer: z.object({
    following: z.boolean().optional(),
    followedBy: z.boolean().optional(),
    muted: z.boolean().optional(),
    blocked: z.boolean().optional()
  }).strict().optional()
}).strict();
export type Profile = z.infer<typeof profileSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().max(640).nullable().optional(),
  description: z.string().max(2560).nullable().optional(),
  avatarRef: z.record(z.string(), z.unknown()).nullable().optional(),
  bannerRef: z.record(z.string(), z.unknown()).nullable().optional()
}).strict();

// ---------------------------------------------------------------------------
// Posts and embeds
// ---------------------------------------------------------------------------

export const postDestinationSchema = z.enum(["town", "bluesky"]);
export type PostDestination = z.infer<typeof postDestinationSchema>;

export const preparePostSchemaV2 = z.object({
  destination: postDestinationSchema.default("town"),
  text: z.string().max(4000),
  replyToUri: z.string().max(2048).optional(),
  quoteUri: z.string().max(2048).optional(),
  quoteCid: z.string().max(200).optional(),
  languages: z.array(z.string().max(8)).max(3).optional(),
  mediaDraftIds: z.array(z.string().max(64)).max(4).optional(),
  expectedRevision: revisionSchema.nullable()
}).strict();
export type PreparePostInput = z.infer<typeof preparePostSchemaV2>;

export const publishPostSchemaV2 = z.object({ draftRevision: revisionSchema }).strict();

export const postSchema = z.object({
  uri: z.string().max(2048),
  cid: z.string().max(200),
  author: z.object({ did: didSchema, handle: z.string(), displayName: z.string().optional() }).strict(),
  text: z.string(),
  createdAt: z.string(),
  destination: postDestinationSchema.optional(),
  replyToUri: z.string().max(2048).optional(),
  embeds: z.array(z.record(z.string(), z.unknown())).max(4).optional(),
  likeCount: z.number().int().nonnegative().optional(),
  repostCount: z.number().int().nonnegative().optional(),
  viewer: z.object({
    liked: z.boolean().optional(),
    reposted: z.boolean().optional()
  }).strict().optional()
}).strict();
export type Post = z.infer<typeof postSchema>;

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

export const feedCursorSchema = z.string().max(512);
export const feedPageSchema = z.object({
  posts: z.array(postSchema).max(50),
  cursor: feedCursorSchema.optional()
}).strict();
export type FeedPage = z.infer<typeof feedPageSchema>;

export const feedViewSchema = z.object({ posts: z.array(postSchema).max(50), cursor: feedCursorSchema.optional() }).strict();

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchKindSchema = z.enum(["actors", "posts", "feeds"]);
export const searchQuerySchema = z.object({
  kind: searchKindSchema,
  q: z.string().min(1).max(64),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(25)
}).strict();

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationSchema = z.object({
  uri: z.string().max(2048),
  reason: z.string().max(64),
  reasonSubject: z.string().max(2048).optional(),
  isRead: z.boolean(),
  indexedAt: z.string(),
  author: z.object({ did: didSchema, handle: z.string() }).strict()
}).strict();
export type Notification = z.infer<typeof notificationSchema>;

// ---------------------------------------------------------------------------
// Graph actions
// ---------------------------------------------------------------------------

export const graphActionSchema = z.enum(["follow", "unfollow", "block", "unblock", "mute", "unmute"]);
export const graphMutationSchema = z.object({
  action: graphActionSchema,
  actor: z.string().max(315),
  expectedState: z.boolean().optional()
}).strict();

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const imageAltSchema = z.string().max(1500);
export const prepareImageSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  alt: imageAltSchema,
  sizeBytes: z.number().int().min(1).max(1_000_000),
  confirmNoAlt: z.boolean().optional()
}).strict();

export const prepareVideoSchema = z.object({
  mimeType: z.enum(["video/mp4"]),
  alt: imageAltSchema.optional(),
  sizeBytes: z.number().int().min(1).max(100_000_000)
}).strict();

export const mediaJobSchema = z.object({
  draftId: z.string().max(64),
  kind: z.enum(["image", "video"]),
  status: z.enum(["preparing", "uploading", "processing", "ready", "failed"]),
  blobRef: z.record(z.string(), z.unknown()).optional(),
  errorMessage: z.string().max(300).optional()
}).strict();
export type MediaJob = z.infer<typeof mediaJobSchema>;

// ---------------------------------------------------------------------------
// Direct messages
// ---------------------------------------------------------------------------

export const convoSummarySchema = z.object({
  convoId: z.string().max(64),
  lastMessage: z.object({
    id: z.string().max(64),
    text: z.string().max(4000),
    sentAt: z.string(),
    senderDid: didSchema
  }).strict(),
  unreadCount: z.number().int().nonnegative(),
  muted: z.boolean(),
  status: z.enum(["accepted", "request"]).optional()
}).strict();
export type ConvoSummary = z.infer<typeof convoSummarySchema>;

export const dmMessageSchema = z.object({
  id: z.string().max(64),
  text: z.string().max(4000),
  senderDid: didSchema,
  sentAt: z.string(),
  deleted: z.boolean().optional(),
  reactions: z.array(z.object({ value: z.string().max(8), count: z.number().int().nonnegative() }).strict()).max(10).optional()
}).strict();
export type DmMessage = z.infer<typeof dmMessageSchema>;

// ---------------------------------------------------------------------------
// Home settings (plan §B6 — local-PDS users only)
// ---------------------------------------------------------------------------

export const homeModeSchema = z.enum(["standard", "authored"]);
export const homeSettingsSchema = z.object({
  did: didSchema,
  mode: homeModeSchema,
  activeHomePath: z.string().max(128).nullable(),
  updatedAt: z.number().int().nonnegative()
}).strict();
export type HomeSettings = z.infer<typeof homeSettingsSchema>;

// ---------------------------------------------------------------------------
// Districts (plan §E4)
// ---------------------------------------------------------------------------

export const districtExperienceSchema = z.object({
  siteSlug: z.string().max(64),
  path: z.string().max(128).default("index.html"),
  title: z.string().max(100),
  previewAssetPath: z.string().max(128).optional()
}).strict();
export type DistrictExperience = z.infer<typeof districtExperienceSchema>;

// ---------------------------------------------------------------------------
// Trusted action requests (plan §E2 — authored home bridges)
// ---------------------------------------------------------------------------

export const trustedActionKindSchema = z.enum([
  "open-post", "open-profile", "open-conversation", "toggle-follow", "like-post", "reply-to-post"
]);
export const trustedActionRequestSchema = z.object({
  kind: trustedActionKindSchema,
  subjectUri: z.string().max(2048).optional(),
  actorInput: z.string().max(315).optional()
}).strict();

// ---------------------------------------------------------------------------
// Tenant tool manifests (plan §F2)
// ---------------------------------------------------------------------------

const toolNameSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/);
const jsonSchemaSubsetSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.literal("object"),
    properties: z.record(z.string().max(48), jsonSchemaSubsetValueSchema).refine((entries) => Object.keys(entries).length <= 32, "At most 32 properties"),
    required: z.array(z.string().max(48)).max(32).optional(),
    additionalProperties: z.literal(false)
  }).strict()
);
const jsonSchemaSubsetValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      type: z.enum(["string", "number", "boolean"]),
      description: z.string().max(200).optional(),
      enum: z.array(z.union([z.string().max(100), z.number(), z.boolean()])).max(16).optional()
    }).strict(),
    z.object({
      type: z.literal("array"),
      items: jsonSchemaSubsetValueSchema,
      maxItems: z.number().int().min(0).max(32).optional()
    }).strict(),
    jsonSchemaSubsetSchema
  ])
);

export const tenantToolSchema = z.object({
  name: toolNameSchema,
  title: z.string().max(100).optional(),
  description: z.string().min(1).max(500),
  inputSchema: jsonSchemaSubsetSchema
}).strict();

export const tenantToolManifestSchema = z.object({
  $schema: z.string().max(200).optional(),
  version: z.literal(1),
  tools: z.array(tenantToolSchema).min(1).max(8)
}).strict();
export type TenantToolManifest = z.infer<typeof tenantToolManifestSchema>;
export type TenantTool = z.infer<typeof tenantToolSchema>;
