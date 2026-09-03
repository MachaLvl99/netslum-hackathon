import type { NotificationItem } from "./types.js";

export interface NotificationsViewProps {
  notifications: NotificationItem[];
  loading: boolean;
  onMarkSeen?: () => void;
  navigate: (route: string) => void;
}

const REASON_LABELS: Record<string, string> = {
  mention: "mentioned you in a broadcast",
  like: "liked your broadcast",
  repost: "reposted your broadcast",
  follow: "followed your identity",
  quote: "quoted your broadcast",
  reply: "replied to your broadcast"
};

export function NotificationsView(props: NotificationsViewProps) {
  const { notifications, loading, onMarkSeen, navigate } = props;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <view className="content">
      <view className="notifications-header-row">
        <view>
          <text className="kicker">ACTIVITY ALERTS</text>
          <text className="title">network signals ({notifications.length})</text>
        </view>

        {unreadCount > 0 && onMarkSeen ? (
          <text className="secondary-sm" bindtap={onMarkSeen}>
            MARK ALL SEEN
          </text>
        ) : null}
      </view>

      {loading ? <text className="copy">Checking network signals…</text> : null}

      <view className="feed-list">
        {notifications.length > 0 ? (
          notifications.map((entry) => (
            <view
              key={entry.uri}
              className={entry.isRead ? "notification-card" : "notification-card unread"}
              bindtap={() => {
                if (entry.reason === "follow") {
                  navigate(`/profile/${encodeURIComponent(entry.authorHandle || entry.authorDid)}`);
                } else {
                  navigate(`/post/${encodeURIComponent(entry.uri)}`);
                }
              }}
            >
              <view className="post-header">
                <text className="post-author">@{entry.authorHandle || "unknown"}</text>
                <text className="notification-reason">{REASON_LABELS[entry.reason] ?? entry.reason}</text>
              </view>
              <text className="post-time">{new Date(entry.indexedAt).toLocaleString()}</text>
            </view>
          ))
        ) : !loading ? (
          <text className="text-empty">No activity notifications yet.</text>
        ) : null}
      </view>
    </view>
  );
}
