const APPVIEW_AUDIENCE = "did:web:api.bsky.app#bsky_appview";
const CHAT_AUDIENCE = "did:web:api.bsky.chat#bsky_chat";
// Proven live (A4): the Bluesky video service requires service-auth tokens
// minted by the account's PDS with the audience did:web:video.bsky.app —
// the video service DID itself, not the account's PDS DID. The wildcard
// uploadBlob scope below permits minting that token for this audience.
export const VIDEO_SERVICE_AUDIENCE = "did:web:video.bsky.app";
export const OAUTH_SCOPE_VERSION = 3;
export const LEGACY_OAUTH_SCOPE = "atproto repo:app.bsky.feed.post?action=create repo:app.bsky.feed.like?action=create&action=delete repo:app.bsky.feed.repost?action=create&action=delete repo:sh.macha.netslumSite?action=create&action=update&action=delete blob:*/*";

export const APPVIEW_METHODS = [
  "app.bsky.actor.getPreferences",
  "app.bsky.actor.getProfile",
  "app.bsky.actor.getProfiles",
  "app.bsky.actor.putPreferences",
  "app.bsky.actor.searchActors",
  "app.bsky.actor.searchActorsTypeahead",
  "app.bsky.bookmark.createBookmark",
  "app.bsky.bookmark.deleteBookmark",
  "app.bsky.bookmark.getBookmarks",
  "app.bsky.feed.getActorLikes",
  "app.bsky.feed.getAuthorFeed",
  "app.bsky.feed.getFeed",
  "app.bsky.feed.getFeedGenerator",
  "app.bsky.feed.getFeedGenerators",
  "app.bsky.feed.getLikes",
  "app.bsky.feed.getPostThread",
  "app.bsky.feed.getPosts",
  "app.bsky.feed.getQuotes",
  "app.bsky.feed.getRepostedBy",
  "app.bsky.feed.getSuggestedFeeds",
  "app.bsky.feed.getTimeline",
  "app.bsky.feed.searchPosts",
  "app.bsky.feed.searchPostsV2",
  "app.bsky.graph.getBlocks",
  "app.bsky.graph.getFollowers",
  "app.bsky.graph.getFollows",
  "app.bsky.graph.getKnownFollowers",
  "app.bsky.graph.getMutes",
  "app.bsky.graph.getRelationships",
  "app.bsky.graph.muteActor",
  "app.bsky.graph.unmuteActor",
  "app.bsky.labeler.getServices",
  "app.bsky.notification.getPreferences",
  "app.bsky.notification.getUnreadCount",
  "app.bsky.notification.listNotifications",
  "app.bsky.notification.putPreferencesV2",
  "app.bsky.notification.updateSeen",
  "app.bsky.unspecced.getPopularFeedGenerators"
] as const;

export const CHAT_METHODS = [
  "chat.bsky.actor.getStatus",
  "chat.bsky.convo.acceptConvo",
  "chat.bsky.convo.addReaction",
  "chat.bsky.convo.deleteMessageForSelf",
  "chat.bsky.convo.getConvo",
  "chat.bsky.convo.getConvoAvailability",
  "chat.bsky.convo.getConvoForMembers",
  "chat.bsky.convo.getMessages",
  "chat.bsky.convo.getUnreadCounts",
  "chat.bsky.convo.listConvoRequests",
  "chat.bsky.convo.listConvos",
  "chat.bsky.convo.muteConvo",
  "chat.bsky.convo.removeReaction",
  "chat.bsky.convo.sendMessage",
  "chat.bsky.convo.unmuteConvo",
  "chat.bsky.convo.updateAllRead",
  "chat.bsky.convo.updateRead"
] as const;

const repositoryScopes = [
  "repo:app.bsky.actor.profile?action=create&action=update",
  "repo:app.bsky.feed.post?action=create&action=delete",
  "repo:app.bsky.feed.like?action=create&action=delete",
  "repo:app.bsky.feed.repost?action=create&action=delete",
  "repo:app.bsky.feed.postgate?action=create&action=update&action=delete",
  "repo:app.bsky.feed.threadgate?action=create&action=update&action=delete",
  "repo:app.bsky.graph.follow?action=create&action=delete",
  "repo:app.bsky.graph.block?action=create&action=delete",
  "repo:chat.bsky.actor.declaration?action=create&action=update",
  "repo:sh.macha.netslumSite?action=create&action=update&action=delete"
] as const;

function rpcScope(method: string, audience: string): string {
  return `rpc:${method}?aud=${encodeURIComponent(audience)}`;
}

export const VIDEO_METHODS = [
  "app.bsky.video.abortUpload",
  "app.bsky.video.findVideoRepo",
  "app.bsky.video.finishUpload",
  "app.bsky.video.getJobStatus",
  "app.bsky.video.getUploadLimits",
  "app.bsky.video.getUploadStatus",
  "app.bsky.video.startUpload",
  "app.bsky.video.uploadPart"
] as const;

const PHASE2_REQUIRED_SCOPES = [
  "atproto",
  ...repositoryScopes,
  "blob:*/*",
  rpcScope("com.atproto.repo.uploadBlob", "*"),
  rpcScope("com.atproto.moderation.createReport", "*"),
  ...APPVIEW_METHODS.map((method) => rpcScope(method, APPVIEW_AUDIENCE)),
  ...CHAT_METHODS.map((method) => rpcScope(method, CHAT_AUDIENCE))
] as const;

export const PHASE2_OAUTH_SCOPE = [
  ...PHASE2_REQUIRED_SCOPES,
  // Optional direct video-method grants. Bluesky currently drops these
  // scopes, while Tranquil grants them. The required uploadBlob wildcard
  // still authorizes PDS-minted service tokens for the multipart service.
  ...VIDEO_METHODS.map((method) => rpcScope(method, VIDEO_SERVICE_AUDIENCE))
].join(" ");

export function grantedScopeContainsRequired(grantedScope: string): boolean {
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  if (granted.has("atproto")) return true;
  return PHASE2_REQUIRED_SCOPES.every((scope) => granted.has(scope));
}
