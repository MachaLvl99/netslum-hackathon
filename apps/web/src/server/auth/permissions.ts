const APPVIEW_AUDIENCE = "did:web:api.bsky.app#bsky_appview";
const CHAT_AUDIENCE = "did:web:api.bsky.chat#bsky_chat";

export const OAUTH_SCOPE_VERSION = 2;
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

export const PHASE2_OAUTH_SCOPE = [
  "atproto",
  ...repositoryScopes,
  "blob:*/*",
  // The video service uses a service-auth token whose audience is the
  // account's PDS DID. The PDS varies by actor, so the audience must be
  // wildcarded while the permitted method remains exact.
  rpcScope("com.atproto.repo.uploadBlob", "*"),
  // Reports may target the user's selected labeler, not necessarily Bluesky's
  // AppView, so only the endpoint is fixed.
  rpcScope("com.atproto.moderation.createReport", "*"),
  ...APPVIEW_METHODS.map((method) => rpcScope(method, APPVIEW_AUDIENCE)),
  ...CHAT_METHODS.map((method) => rpcScope(method, CHAT_AUDIENCE))
].join(" ");

export function grantedScopeContainsRequired(grantedScope: string): boolean {
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return PHASE2_OAUTH_SCOPE.split(" ").every((scope) => granted.has(scope));
}
