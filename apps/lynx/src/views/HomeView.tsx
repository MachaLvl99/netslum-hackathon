import { useState } from "@lynx-js/react";
import { zonePlaces, zonePrefixes, zoneStates } from "@netslum/contracts";
import type { PostItem } from "./types.js";
import { FeedList } from "./FeedList.js";

/**
 * .hack-style server map: each canonical zone prefix belongs to one server.
 * Selecting a server reveals the 3-keyword Chaos Gate entry.
 */
const SERVERS = [
  { id: "delta", letter: "Δ", prefix: "hidden" },
  { id: "theta", letter: "Θ", prefix: "burning" },
  { id: "lambda", letter: "Λ", prefix: "silent" },
  { id: "sigma", letter: "Σ", prefix: "wandering" },
  { id: "omega", letter: "Ω", prefix: "broken" },
  { id: "alpha", letter: "α", prefix: "electric" }
] as const;

/** The example zone shown on the homepage: "hidden forbidden holy ground". */
const EXAMPLE_ZONE_KEY = "hidden.forbidden.holy_ground";

export interface HomeViewProps {
  authenticated: boolean;
  navigate: (route: string) => void;
  feedStale: boolean;
  destination: "town" | "bluesky";
  setDestination: (value: "town" | "bluesky") => void;
  postText: string;
  setPostText: (value: string) => void;
  postBusy: boolean;
  submitPost: () => void;
  posts: PostItem[];
  onReact: (uri: string, cid: string, action: string) => void;
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function HomeView(props: HomeViewProps) {
  const {
    authenticated,
    navigate,
    feedStale,
    destination,
    setDestination,
    postText,
    setPostText,
    postBusy,
    submitPost,
    posts,
    onReact
  } = props;

  const [server, setServer] = useState<string | null>(null);
  const [kw1, setKw1] = useState("");
  const [kw2, setKw2] = useState("");
  const [kw3, setKw3] = useState("");
  const [personQuery, setPersonQuery] = useState("");
  const [zoneError, setZoneError] = useState("");

  const selectServer = (id: string, prefix?: string): void => {
    setServer(id);
    setZoneError("");
    if (prefix) setKw1(prefix);
  };

  const enterZone = (): void => {
    const k1 = normalizeKeyword(kw1);
    const k2 = normalizeKeyword(kw2);
    const k3 = normalizeKeyword(kw3);
    if (!(zonePrefixes as readonly string[]).includes(k1)) {
      setZoneError(`KEYWORD 1 // VALID: ${(zonePrefixes as readonly string[]).join(", ")}`);
      return;
    }
    if (!(zonePlaces as readonly string[]).includes(k2)) {
      setZoneError(`KEYWORD 2 // VALID: ${(zonePlaces as readonly string[]).join(", ")}`);
      return;
    }
    if (!(zoneStates as readonly string[]).includes(k3)) {
      setZoneError(`KEYWORD 3 // VALID: ${(zoneStates as readonly string[]).join(", ")}`);
      return;
    }
    navigate(`/zone/${k1}.${k2}.${k3}`);
  };

  const findPerson = (): void => {
    const query = personQuery.trim().replace(/^@/, "");
    if (query) navigate(`/profile/${encodeURIComponent(query)}`);
  };

  return (
    <view className="content">
      {/* PARADISE PANEL — fully centered */}
      <view className="paradise-center">
        <text className="welcome-title">welcome to Paradise.</text>
        <view className="server-row">
          {SERVERS.map((s) => (
            <text
              key={s.id}
              className={server === s.id ? "server-chip active" : "server-chip"}
              accessibility-label={`select ${s.id} server`}
              bindtap={() => selectServer(s.id, s.prefix)}
            >
              {s.letter}
            </text>
          ))}
          <text
            className={server === "at" ? "server-chip active" : "server-chip"}
            accessibility-label="search people's personal zones"
            bindtap={() => selectServer("at")}
          >
            @
          </text>
        </view>

        {server === "at" ? (
          <view className="zone-entry">
            <view className="person-search-row">
              <input
                className="zone-input"
                placeholder="@handle — find a personal zone"
                default-value={personQuery}
                bindinput={(e) => setPersonQuery(e.detail.value)}
              />
              <text className="primary-sm" bindtap={findPerson}>FIND &rarr;</text>
            </view>
          </view>
        ) : server ? (
          <view className="zone-entry">
            <view className="zone-input-row">
              <input
                className="zone-input"
                placeholder="hidden"
                default-value={kw1}
                bindinput={(e) => setKw1(e.detail.value)}
              />
              <input
                className="zone-input"
                placeholder="forbidden"
                default-value={kw2}
                bindinput={(e) => setKw2(e.detail.value)}
              />
              <input
                className="zone-input"
                placeholder="holy ground"
                default-value={kw3}
                bindinput={(e) => setKw3(e.detail.value)}
              />
            </view>
            <text className="primary-sm" style="margin-top:16px;" bindtap={enterZone}>ENTER &rarr;</text>
            {zoneError ? <text className="zone-error">{zoneError}</text> : null}
            <text
              className="example-hint"
              bindtap={() => navigate(`/zone/${EXAMPLE_ZONE_KEY}`)}
            >
              EXAMPLE: Δ hidden forbidden holy ground &rarr;
            </text>
          </view>
        ) : null}
      </view>

      {/* COMBINED FEED — town square + timeline merged */}
      {feedStale ? <text className="stale-label">LIVE INDEX DELAYED // SHOWING RECENT LOCAL ACTIVITY</text> : null}
      {authenticated ? (
        <view className="composer-card">
          <text className="composer-label">COMPOSE</text>
          <view className="composer-destinations">
            <text
              className={destination === "town" ? "dest-chip active" : "dest-chip"}
              bindtap={() => setDestination("town")}
            >#netslum</text>
            <text
              className={destination === "bluesky" ? "dest-chip active" : "dest-chip"}
              bindtap={() => setDestination("bluesky")}
            >bluesky</text>
          </view>
          <input
            className="composer-input"
            placeholder={destination === "town" ? "Share notes, thoughts, or directives with the slum..." : "Post to your Bluesky followers..."}
            default-value={postText}
            bindinput={(e) => setPostText(e.detail.value)}
          />
          <view className="composer-footer">
            <text className="char-count">{postText.length + (destination === "town" ? 10 : 0)} / 300</text>
            <text className={postBusy ? "primary-sm busy" : "primary-sm"} bindtap={submitPost}>
              {postBusy ? "PUBLISHING…" : destination === "town" ? "POST TO #NETSLUM" : "POST TO BLUESKY"}
            </text>
          </view>
        </view>
      ) : (
        <view className="notice-card" bindtap={() => navigate("/oauth/login")}>
          <text className="notice-text">Sign in with AT Protocol to broadcast posts and drop notes.</text>
        </view>
      )}

      <FeedList
        posts={posts}
        navigate={navigate}
        onReact={authenticated ? onReact : undefined}
        emptyText="No posts yet. Be the first to broadcast!"
      />
    </view>
  );
}
