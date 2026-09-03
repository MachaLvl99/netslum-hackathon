import type { FeedResultItem, PostItem } from "./types.js";
import { PostEmbeds } from "./PostEmbeds.js";

export interface SearchViewProps {
  query: string;
  onQueryChange: (value: string) => void;
  searchKind: "actors" | "posts" | "feeds";
  onSearchKindChange: (kind: "posts" | "actors" | "feeds") => void;
  posts: PostItem[];
  actorHandles: string[];
  feeds: FeedResultItem[];
  searching: boolean;
  onSearch: () => void;
  navigate: (route: string) => void;
}

export function SearchView(props: SearchViewProps) {
  const {
    query,
    onQueryChange,
    searchKind,
    onSearchKindChange,
    posts,
    actorHandles,
    feeds,
    searching,
    onSearch,
    navigate
  } = props;

  return (
    <view className="view-search">
      <text className="kicker">EXPLORER SEARCH</text>
      <text className="title">find posts, travelers, and feeds</text>

      <view className="search-bar-row">
        <input
          className="search-input"
          placeholder={`Search ${searchKind}…`}
          default-value={query}
          bindinput={(e) => onQueryChange(e.detail.value)}
        />
        <text
          className={searching ? "primary-sm busy" : "primary-sm"}
          bindtap={onSearch}
        >
          {searching ? "SEARCHING…" : "SEARCH"}
        </text>
      </view>

      <view className="search-type-row">
        {(["posts", "actors", "feeds"] as const).map((kind) => (
          <text
            key={kind}
            className={searchKind === kind ? "search-type active" : "search-type"}
            bindtap={() => onSearchKindChange(kind)}
          >
            {kind.toUpperCase()}
          </text>
        ))}
      </view>

      <view className="feed-list">
        {searchKind === "actors" && actorHandles.length > 0 ? (
          actorHandles.map((handle) => (
            <view
              key={handle}
              className="actor-result-card"
              bindtap={() => navigate(`/profile/${encodeURIComponent(handle)}`)}
            >
              <text className="actor-handle">@{handle}</text>
              <text className="actor-link">&rarr;</text>
            </view>
          ))
        ) : searchKind === "posts" && posts.length > 0 ? (
          posts.map((p) => (
            <view
              key={p.uri}
              className="post-card"
              bindtap={() => navigate(`/post/${encodeURIComponent(p.uri)}`)}
            >
              <view className="post-header">
                <text className="post-author">@{p.author.handle}</text>
                <text className="post-time">{new Date(p.createdAt).toLocaleTimeString()}</text>
              </view>
              <text className="post-text">{p.text}</text>
              <PostEmbeds embeds={p.embeds} />
            </view>
          ))
        ) : searchKind === "feeds" && feeds.length > 0 ? (
          feeds.map((feed) => (
            <view key={feed.uri} className="post-card">
              <view className="post-header">
                <text className="post-author">{feed.displayName}</text>
                <text className="post-time">by @{feed.creator.handle}</text>
              </view>
              {feed.description ? <text className="post-text">{feed.description}</text> : null}
            </view>
          ))
        ) : !searching ? (
          <text className="text-empty">No results found. Type a query and search.</text>
        ) : null}
      </view>
    </view>
  );
}
