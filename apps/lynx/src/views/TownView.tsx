import type { LynxInputEvent, PostItem } from "./types.js";
import { FEATURED_ZONES } from "./types.js";

export interface TownViewProps {
  compact: boolean;
  activePane: "world" | "feed";
  setActivePane: (pane: "world" | "feed") => void;
  authenticated: boolean;
  feedStale: boolean;
  postText: string;
  setPostText: (value: string) => void;
  postBusy: boolean;
  submitPost: () => void;
  posts: PostItem[];
  navigate: (route: string) => void;
}

export function TownView(props: TownViewProps) {
  const {
    compact,
    activePane,
    setActivePane,
    authenticated,
    feedStale,
    postText,
    setPostText,
    postBusy,
    submitPost,
    posts,
    navigate
  } = props;
  return (
    <view className={compact ? "split-layout compact" : "split-layout"}>
      {compact ? (
        <view className="pane-tabs">
          <text className={activePane === "world" ? "pane-tab active" : "pane-tab"} bindtap={() => setActivePane("world")}>WORLD</text>
          <text className={activePane === "feed" ? "pane-tab active" : "pane-tab"} bindtap={() => setActivePane("feed")}>FEED</text>
        </view>
      ) : null}
      <view className={activePane === "world" || !compact ? "split-world" : "split-world pane-hidden"}>
        <text className="kicker">TOWN SQUARE // WORLD</text>
        <text className="title">#netslum public commons</text>
        <view className="portal-grid">
          {FEATURED_ZONES.map((z) => (
            <view key={z} className="portal-card" bindtap={() => navigate(`/zone/${z}`)}>
              <text className="portal-name">&Delta; {z}</text>
              <text className="portal-desc">Warp directly into sector</text>
            </view>
          ))}
        </view>
      </view>
      <view className={activePane === "feed" || !compact ? "split-feed" : "split-feed pane-hidden"}>
        <text className="kicker">LIVE FEED RAIL</text>
        {feedStale ? <text className="stale-label">LIVE INDEX DELAYED // SHOWING RECENT LOCAL ACTIVITY</text> : null}

        {authenticated ? (
          <view className="composer-card">
            <text className="composer-label">BROADCAST TO #NETSLUM</text>
            <input
              className="composer-input"
              placeholder="Share notes, thoughts, or directives with the slum..."
              value={postText}
              bindinput={(e: LynxInputEvent) => setPostText(e.detail.value)}
            />
            <view className="composer-footer">
              <text className="char-count">{postText.length + 10} / 300</text>
              <text className={postBusy ? "primary-sm busy" : "primary-sm"} bindtap={submitPost}>{postBusy ? "PUBLISHING…" : "POST TO FEDIVERSE"}</text>
            </view>
          </view>
        ) : (
          <view className="notice-card" bindtap={() => navigate("/oauth/login")}>
            <text className="notice-text">Sign in with AT Protocol to broadcast posts and drop notes.</text>
          </view>
        )}

        <view className="feed-list">
          {posts.length > 0 ? (
            posts.map((p) => (
              <view key={p.uri} className="post-card">
                <view className="post-header">
                  <text className="post-author">@{p.author.handle}</text>
                  <text className="post-time">{new Date(p.createdAt).toLocaleTimeString()}</text>
                </view>
                <text className="post-body">{p.text}</text>
              </view>
            ))
          ) : (
            <view className="empty-card">
              <text className="empty-text">No posts yet on #netslum. Be the first to broadcast!</text>
            </view>
          )}
        </view>
      </view>
    </view>
  );
}