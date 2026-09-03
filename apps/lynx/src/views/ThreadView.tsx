import type { PostItem, ThreadItem } from "./types.js";
import { PostEmbeds } from "./PostEmbeds.js";

export interface ThreadViewProps {
  uri: string;
  thread: ThreadItem | null;
  loading: boolean;
  routeError?: string | undefined;
  authenticated: boolean;
  replyDraft: string;
  onReplyDraftChange: (text: string) => void;
  onSendReply: () => void;
  replying: boolean;
  onReact?: ((uri: string, cid: string, action: "like" | "repost") => void) | undefined;
  navigate: (route: string) => void;
}

export function ThreadView(props: ThreadViewProps) {
  const {
    uri,
    thread,
    loading,
    routeError,
    authenticated,
    replyDraft,
    onReplyDraftChange,
    onSendReply,
    replying,
    onReact,
    navigate
  } = props;

  const rootPost: PostItem | undefined = thread?.post;
  const parentPost: ThreadItem | undefined = thread?.parent;
  const replies: ThreadItem[] = thread?.replies ?? [];

  return (
    <view className="content">
      <view className="thread-nav-header">
        <text className="back-link" bindtap={() => navigate("/timeline")}>
          &larr; BACK
        </text>
        <text className="kicker">AT PROTOCOL POST THREAD</text>
      </view>

      {routeError ? <text className="stale-label">{routeError}</text> : null}
      {loading ? <text className="copy">Loading thread from AT Protocol…</text> : null}

      {/* PARENT POST (IF ANY) */}
      {parentPost?.post ? (
        <view
          className="parent-post-card"
          bindtap={() => navigate(`/post/${encodeURIComponent(parentPost.post.uri)}`)}
        >
          <view className="post-header">
            <text className="post-author">@{parentPost.post.author.handle}</text>
            <text className="post-time">{new Date(parentPost.post.createdAt).toLocaleTimeString()}</text>
          </view>
          <text className="post-text">{parentPost.post.text}</text>
          <PostEmbeds embeds={parentPost.post.embeds} />
          <text className="thread-line-indicator">&darr; in reply to this post</text>
        </view>
      ) : null}

      {/* ROOT / TARGET POST */}
      {rootPost ? (
        <view className="root-post-card">
          <view className="post-header">
            <view
              className="post-author-block"
              bindtap={() => navigate(`/profile/${encodeURIComponent(rootPost.author.did)}`)}
            >
              <text className="post-author">@{rootPost.author.handle}</text>
              {rootPost.author.displayName ? (
                <text className="author-display-name">{rootPost.author.displayName}</text>
              ) : null}
            </view>
            <text className="post-time">{new Date(rootPost.createdAt).toLocaleString()}</text>
          </view>

          <text className="root-post-text">{rootPost.text}</text>
          <PostEmbeds embeds={rootPost.embeds} />

          {/* ENGAGEMENT & ACTIONS */}
          <view className="post-actions-bar">
            {onReact ? (
              <text
                className={rootPost.viewer?.like ? "action-chip active" : "action-chip"}
                bindtap={() => onReact(rootPost.uri, rootPost.cid, "like")}
              >
                ❤️ {rootPost.likeCount ?? (rootPost.viewer?.like ? 1 : 0)} LIKES
              </text>
            ) : null}
            {onReact ? (
              <text
                className={rootPost.viewer?.repost ? "action-chip active" : "action-chip"}
                bindtap={() => onReact(rootPost.uri, rootPost.cid, "repost")}
              >
                🔁 {rootPost.repostCount ?? 0} REPOSTS
              </text>
            ) : null}
          </view>

          {/* REPLY COMPOSER */}
          {authenticated ? (
            <view className="thread-reply-composer">
              <text className="composer-label">REPLY TO @{rootPost.author.handle}</text>
              <input
                className="composer-input"
                placeholder="Write your reply..."
                default-value={replyDraft}
                bindinput={(e) => onReplyDraftChange(e.detail.value)}
              />
              <view className="composer-footer">
                <text className="char-count">{replyDraft.length} / 290</text>
                <text
                  className={replying ? "primary-sm busy" : "primary-sm"}
                  bindtap={onSendReply}
                >
                  {replying ? "SENDING REPLY…" : "REPLY"}
                </text>
              </view>
            </view>
          ) : (
            <view className="panel-sm" bindtap={() => navigate("/oauth/login")}>
              <text className="copy-sm">Sign in with AT Protocol to reply to this post.</text>
            </view>
          )}
        </view>
      ) : !loading ? (
        <text className="copy">Post not found or unavailable ({uri.slice(0, 32)}…)</text>
      ) : null}

      {/* REPLIES */}
      {replies.length > 0 ? (
        <view className="replies-section">
          <text className="section-title">// REPLIES ({replies.length})</text>
          <view className="feed-list">
            {replies.map((r) => (
              <view
                key={r.post.uri}
                className="reply-card"
                bindtap={() => navigate(`/post/${encodeURIComponent(r.post.uri)}`)}
              >
                <view className="post-header">
                  <text className="post-author">@{r.post.author.handle}</text>
                  <text className="post-time">{new Date(r.post.createdAt).toLocaleTimeString()}</text>
                </view>
                <text className="post-text">{r.post.text}</text>
                <PostEmbeds embeds={r.post.embeds} />
                <view className="reply-footer">
                  <text className="reply-like-count">❤️ {r.post.likeCount ?? 0}</text>
                </view>
              </view>
            ))}
          </view>
        </view>
      ) : null}
    </view>
  );
}
