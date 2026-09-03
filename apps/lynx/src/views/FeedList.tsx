import type { PostItem } from "./types.js";
import { PostEmbeds } from "./PostEmbeds.js";

/**
 * FeedList — Phase 3 reusable feed display building block.
 *
 * Renders post cards (author navigation, inline video embeds, like metrics)
 * and is intentionally self-contained so future WebMCP tools can reuse it
 * as a display component: point it at any PostItem[] and it renders.
 * Used by the homepage combined feed, the (deprecated) timeline view, and
 * the town square.
 */
export interface FeedListProps {
  posts: PostItem[];
  navigate: (route: string) => void;
  onReact?: ((uri: string, cid: string, action: "like" | "repost") => void) | undefined;
  emptyText?: string;
}

export function FeedList({ posts, navigate, onReact, emptyText }: FeedListProps) {
  if (posts.length === 0) {
    return (
      <view className="feed-list">
        <view className="empty-card">
          <text className="empty-text">{emptyText ?? "Nothing here yet."}</text>
        </view>
      </view>
    );
  }
  return (
    <view className="feed-list">
      {posts.map((p) => (
        <view
          key={p.uri}
          className="post-card"
          bindtap={() => navigate(`/post/${encodeURIComponent(p.uri)}`)}
        >
          <view className="post-header">
            <view
              className="post-author-block"
              catchtap={() => navigate(`/profile/${encodeURIComponent(p.author.did || p.author.handle)}`)}
            >
              <text className="post-author">@{p.author.handle}</text>
              {p.author.displayName ? (
                <text className="author-display-name">{p.author.displayName}</text>
              ) : null}
            </view>
            <text className="post-time">{new Date(p.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>
          </view>
          <text className="post-text">{p.text}</text>
          <PostEmbeds embeds={p.embeds} />
          <view className="post-footer-metrics">
            {onReact ? (
              <text
                className={p.viewer?.like ? "metric-tag active" : "metric-tag"}
                catchtap={() => onReact(p.uri, p.cid, "like")}
              >
                ❤️ {p.likeCount ?? (p.viewer?.like ? 1 : 0)}
              </text>
            ) : null}
            {p.replyCount ? (
              <text className="metric-tag">💬 {p.replyCount}</text>
            ) : null}
            {p.repostCount ? (
              <text className="metric-tag">🔁 {p.repostCount}</text>
            ) : null}
          </view>
        </view>
      ))}
    </view>
  );
}
