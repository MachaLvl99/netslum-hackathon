import type { PostItem } from "./types.js";
import { FeedList } from "./FeedList.js";

/**
 * TimelineView — the followed-feed page (soon to be deprecated).
 *
 * Phase 3 note: this view is preserved as a thin wrapper over the shared
 * FeedList building block, and host.ts's `loadTimelinePage()` remains its
 * data source. Together they form the reusable "timeline chunk" that
 * upcoming WebMCP tools can repurpose as display building blocks.
 */
export interface TimelineViewProps {
  posts: PostItem[];
  loading: boolean;
  onReact?: ((uri: string, cid: string, action: "like" | "repost") => void) | undefined;
  navigate: (route: string) => void;
}

export function TimelineView(props: TimelineViewProps) {
  const { posts, loading, onReact, navigate } = props;
  return (
    <view className="content">
      <text className="kicker">FOLLOWING // TIMELINE</text>
      {loading ? <text className="copy">Streaming updates from follow graph…</text> : null}
      <FeedList
        posts={posts}
        navigate={navigate}
        onReact={onReact}
        emptyText="Follow accounts to see their broadcasts here."
      />
    </view>
  );
}
