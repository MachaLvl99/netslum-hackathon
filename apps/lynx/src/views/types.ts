export interface InitData {
  route?: string;
  authenticated?: boolean;
  did?: string;
  handle?: string;
  displayHandle?: string;
  headerAvatar?: string;
  canPublishSite?: boolean;
  canAuthorHome?: boolean;
  canUseDms?: boolean;
  canUploadVideo?: boolean;
  dmAgentEnabled?: boolean;
  scopeVersion?: number;
  reauthorizeRequired?: boolean;
  feed?: string;
  zone?: string;
  site?: string;
  profile?: string;
  actionStatus?: string;
  routeError?: string;
  feedStale?: boolean;
  compactViewport?: boolean;
  lastUpdatedAt?: number;
  timeline?: string;
  notifications?: string;
  conversations?: string;
  composeRecipient?: string;
  messages?: string;
  actorHandles?: string;
  authorPosts?: string;
  searchPosts?: string;
  searchFeeds?: string;
  homeSettings?: string;
  chatDeclaration?: string;
  homeLayout?: string;
  publicPageSchema?: string;
  thread?: string;
  district?: string;
}

export interface PostItem {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName?: string; avatar?: string };
  text: string;
  createdAt: string;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewer?: { like?: string; repost?: string; [key: string]: unknown };
  embeds?: Array<Record<string, unknown>>;
}

export interface FeedResultItem {
  uri: string;
  cid: string;
  displayName: string;
  description?: string;
  creator: { did: string; handle: string; displayName?: string };
}

export interface DistrictExperience {
  siteSlug: string;
  path?: string;
  title: string;
  previewAssetPath?: string;
}

export interface ZoneObjectItem {
  id: string;
  type: string;
  x: number;
  y: number;
  text?: string;
  shape?: string;
  color?: string;
  targetZoneKey?: string;
  experience?: DistrictExperience;
}

export interface LynxInputEvent {
  detail: { value: string };
}

export interface ActionStatus {
  action: "post" | "zone" | "site" | "logout" | "message" | "search" | "profile" | "graph" | "settings";
  state: "busy" | "success" | "error";
  message: string;
  nonce: number;
}

export interface SiteFileInfo {
  path: string;
  size: number;
}

export interface ProfileInfo {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  siteUrl?: string | null;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  viewer?: {
    following?: string;
    followedBy?: string;
    muted?: boolean;
    blockedBy?: boolean;
    blocking?: string;
  };
}

export interface HomeSettings {
  did: string;
  mode: "standard" | "authored";
  activeHomePath: string | null;
  updatedAt: number;
}

export interface ThreadItem {
  post: PostItem;
  parent?: ThreadItem;
  replies?: ThreadItem[];
}

export interface ConversationItem {
  convoId: string;
  lastMessageText?: string;
  lastMessageSender?: string;
  unreadCount: number;
  otherHandle?: string;
  otherDid?: string;
  muted?: boolean;
  status?: "accepted" | "request";
}

export interface ConversationMessageItem {
  id: string;
  text: string;
  senderDid: string;
  sentAt?: string;
  reactions?: Array<{ value: string; count: number }>;
}
export const FEATURED_ZONES = [
  "hidden.archive.echo",
  "burning.market.static",
  "silent.garden.rain",
  "wandering.harbor.dream",
  "broken.labyrinth.void",
  "electric.cathedral.dawn"
] as const;

/** .hack-style server letter for each canonical zone prefix (Phase 3). */
export const SERVER_LETTERS: Record<string, string> = {
  hidden: "Δ",
  burning: "Θ",
  silent: "Λ",
  wandering: "Σ",
  broken: "Ω",
  electric: "α"
};

/**
 * Human display for a zone key: "hidden.forbidden.holy_ground" renders as
 * "Δ HIDDEN FORBIDDEN HOLY GROUND" (server letter + spaced uppercase words).
 */
export function zoneDisplayTitle(zoneKey: string): string {
  const parts = zoneKey.split(".");
  const letter = SERVER_LETTERS[parts[0] ?? ""] ?? "";
  const words = parts.map((word) => word.replace(/_/g, " ").toUpperCase()).join(" ");
  return `${letter} ${words}`.trim();
}

export interface NotificationItem {
  uri: string;
  reason: string;
  isRead: boolean;
  indexedAt: string;
  authorDid: string;
  authorHandle: string;
}
