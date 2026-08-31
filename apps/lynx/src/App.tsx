import { useInitData, useInitDataChanged, useState } from "@lynx-js/react";

interface InitData {
  route?: string;
  authenticated?: boolean;
  did?: string;
  handle?: string;
  canPublishSite?: boolean;
  feed?: string;
  zone?: string;
  site?: string;
  actionStatus?: string;
  routeError?: string;
  feedStale?: boolean;
  lastUpdatedAt?: number;
}

interface PostItem {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName?: string };
  text: string;
  createdAt: string;
}

interface ZoneObjectItem {
  id: string;
  type: string;
  x: number;
  y: number;
  text?: string;
  shape?: string;
  color?: string;
  targetZoneKey?: string;
}

interface LynxInputEvent {
  detail: { value: string };
}

interface ActionStatus {
  action: "post" | "zone" | "site" | "logout";
  state: "busy" | "success" | "error";
  message: string;
  nonce: number;
}

declare let NativeModules: {
  NetslumHost: {
    navigate(route: string): void;
    logout(): void;
    postMessage(text: string): void;
    placeZoneNote(zoneKey: string, text: string): void;
    saveSiteFile(path: string, content: string, revision?: string): void;
    publishSite(revision: string): void;
  };
};

const FEATURED_ZONES = [
  "hidden.archive.echo",
  "burning.market.static",
  "silent.garden.rain",
  "wandering.harbor.dream",
  "broken.labyrinth.void",
  "electric.cathedral.dawn"
];

export function App() {
  const initial = useInitData() as InitData;
  const [data, setData] = useState<InitData>(initial);
  const [postText, setPostText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [editorText, setEditorText] = useState("");
  const [handledStatusNonce, setHandledStatusNonce] = useState(0);
  useInitDataChanged((next) => {
    const updated = next as InitData;
    setData(updated);
    if (!updated.actionStatus) return;
    try {
      const status = JSON.parse(updated.actionStatus) as ActionStatus;
      if (status.nonce === handledStatusNonce) return;
      setHandledStatusNonce(status.nonce);
      if (status.state === "success" && status.action === "post") setPostText("");
      if (status.state === "success" && status.action === "zone") setNoteText("");
    } catch (error) {
      void error;
    }
  });

  const navigate = (route: string): void => {
    try {
      NativeModules.NetslumHost.navigate(route);
    } catch (e) {
      void e;
    }
  };

  const logout = (): void => {
    try {
      NativeModules.NetslumHost.logout();
    } catch (e) {
      void e;
    }
  };

  const submitPost = (): void => {
    if (!postText.trim() || postText.length > 290) return;
    try {
      NativeModules.NetslumHost.postMessage(postText);
    } catch (error) {
      void error;
    }
  };

  const submitNote = (zoneKey: string): void => {
    if (!noteText.trim() || noteText.length > 280) return;
    try {
      NativeModules.NetslumHost.placeZoneNote(zoneKey, noteText);
    } catch (error) {
      void error;
    }
  };

  const route = data.route ?? "/";
  const activeZoneKey = route.startsWith("/zone/") ? route.slice(6) : "hidden.archive.echo";

  let posts: PostItem[] = [];
  try {
    if (data.feed) {
      const parsed = JSON.parse(data.feed) as { posts?: PostItem[] };
      posts = parsed.posts ?? [];
    }
  } catch (e) {
    void e;
  }

  let zoneObjects: ZoneObjectItem[] = [];
  let zoneVersion = 0;
  try {
    if (data.zone) {
      const parsed = JSON.parse(data.zone) as { objects?: ZoneObjectItem[]; version?: number };
      zoneObjects = parsed.objects ?? [];
      zoneVersion = parsed.version ?? 0;
    }
  } catch (e) {
    void e;
  }

  let siteSlug = "";
  let siteRevision = "";
  let siteFiles: Array<{ path: string; size: number }> = [];
  try {
    if (data.site) {
      const parsed = JSON.parse(data.site) as { slug?: string; revision?: string; files?: Array<{ path: string; size: number }> };
      siteSlug = parsed.slug ?? "";
      siteRevision = parsed.revision ?? "";
      siteFiles = parsed.files ?? [];
    }
  } catch (e) {
    void e;
  }

  let actionStatus: ActionStatus | null = null;
  try {
    if (data.actionStatus) actionStatus = JSON.parse(data.actionStatus) as ActionStatus;
  } catch (error) {
    void error;
  }
  const postBusy = actionStatus?.action === "post" && actionStatus.state === "busy";
  const zoneBusy = actionStatus?.action === "zone" && actionStatus.state === "busy";

  return (
    <page className="page">
      <view className="shell">
        <view className="header">
          <text className="wordmark" accessibility-label="netslum home" bindtap={() => navigate("/")}>netslum</text>
          <text className={route === "/town" ? "nav-item active" : "nav-item"} accessibility-label="open town square" bindtap={() => navigate("/town")}>town</text>
          <text className={route.startsWith("/gate") || route.startsWith("/zone/") ? "nav-item active" : "nav-item"} accessibility-label="open chaos gate" bindtap={() => navigate("/gate")}>chaos gate</text>
          {data.canPublishSite ? (
            <text className={route === "/studio" ? "nav-item active" : "nav-item"} accessibility-label="open site studio" bindtap={() => navigate("/studio")}>studio</text>
          ) : null}
          <view className="header-right">
            {data.authenticated ? (
              <view className="user-badge">
                <text className="user-handle">{data.handle ?? "connected"}</text>
                <text className="logout-btn" bindtap={logout}>sign out</text>
              </view>
            ) : (
              <text className="login-btn" bindtap={() => navigate("/oauth/login")}>sign in</text>
            )}
          </view>
        </view>
        {actionStatus ? (
          <view className={`status-bar status-${actionStatus.state}`}>
            <text className="status-text">{actionStatus.message}</text>
          </view>
        ) : null}
        {data.routeError ? (
          <view className="status-bar status-error">
            <text className="status-text">{data.routeError}</text>
          </view>
        ) : null}

        <scroll-view className="content-scroll" scroll-orientation="vertical">

        {/* VIEW ROUTING */}
        {route === "/" ? (
          <view className="content">
            <text className="kicker">AGENT-FIRST // AT PROTOCOL SOCIAL SPACE</text>
            <text className="title">the network remembers what we make together</text>
            <text className="copy">
              A federated cyber-commons inspired by .hack Net Slum. Humans guide Codex desktop agents through WebMCP tools,
              traverse Chaos Gate sectors, and publish programmable personal pages powered by Tranquil PDS.
            </text>
            <view className="action-row">
              <text
                className="primary"
                accessibility-label={data.authenticated ? "enter town square" : "sign in with AT Protocol"}
                bindtap={() => navigate(data.authenticated ? "/town" : "/oauth/login")}
              >
                {data.authenticated ? "ENTER TOWN SQUARE &rarr;" : "SIGN IN WITH AT PROTOCOL"}
              </text>
            </view>
            <view className="featured-section">
              <text className="section-title">// ACTIVE CHAOS GATE SECTORS</text>
              <view className="portal-grid">
                {FEATURED_ZONES.map((z) => (
                  <view key={z} className="portal-card" bindtap={() => navigate(`/zone/${z}`)}>
                    <text className="portal-name">&Delta; {z}</text>
                    <text className="portal-desc">Warp directly into sector</text>
                  </view>
                ))}
              </view>
            </view>
          </view>
        ) : route === "/town" ? (
          <view className="content">
            <text className="kicker">TOWN SQUARE // FEDERATED FEED</text>
            <text className="title">#netslum public commons</text>
            {data.feedStale ? <text className="stale-label">LIVE INDEX DELAYED // SHOWING RECENT LOCAL ACTIVITY</text> : null}
            
            {data.authenticated ? (
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
        ) : route === "/gate" || route.startsWith("/zone/") ? (
          <view className="content">
            <text className="kicker">CHAOS GATE // SPATIAL SECTOR</text>
            <text className="title">&Delta; {activeZoneKey}</text>
            <text className="copy">State Version {zoneVersion} &bull; {zoneObjects.length} Objects Active</text>

            <view className="zone-grid-view">
              <text className="section-title">// DROPPED NOTES & ARTIFACTS</text>
              <view className="objects-grid">
                {zoneObjects.length > 0 ? (
                  zoneObjects.map((o) => (
                    <view key={o.id} className="object-card">
                      <text className="object-type">[{o.type.toUpperCase()}] ({o.x}, {o.y})</text>
                      <text className="object-content">{o.text || o.shape || o.targetZoneKey || "artifact"}</text>
                    </view>
                  ))
                ) : (
                  <view className="empty-card">
                    <text className="empty-text">This sector is silent. Leave a note or sigil below.</text>
                  </view>
                )}
              </view>
            </view>

            {data.authenticated ? (
              <view className="composer-card">
                <text className="composer-label">DROP A NOTE IN THIS SECTOR</text>
                <input
                  className="composer-input"
                  placeholder="Inscribe a message for other travelers..."
                  value={noteText}
                  bindinput={(e: LynxInputEvent) => setNoteText(e.detail.value)}
                />
                <view className="composer-footer">
                  <text className={zoneBusy ? "primary-sm busy" : "primary-sm"} bindtap={() => submitNote(activeZoneKey)}>{zoneBusy ? "DROPPING…" : "DROP NOTE"}</text>
                </view>
              </view>
            ) : null}

            <view className="featured-section">
              <text className="section-title">// OTHER DESTINATIONS</text>
              <view className="portal-grid">
                {FEATURED_ZONES.filter(z => z !== activeZoneKey).map((z) => (
                  <view key={z} className="portal-card" bindtap={() => navigate(`/zone/${z}`)}>
                    <text className="portal-name">&Delta; {z}</text>
                  </view>
                ))}
              </view>
            </view>
          </view>
        ) : route === "/studio" ? (
          <view className="content">
            <text className="kicker">PERSONAL SITE STUDIO // @{siteSlug}</text>
            <text className="title">programmable page editor</text>
            <text className="copy">Draft Revision: {siteRevision.slice(0, 16) || "none"}</text>

            <view className="studio-container">
              <view className="file-tree">
                <text className="tree-header">FILES ({siteFiles.length})</text>
                {siteFiles.map(f => (
                  <text key={f.path} className="file-item">&bull; {f.path} ({f.size} B)</text>
                ))}
              </view>

              <view className="editor-panel">
                <text className="editor-label">EDIT index.html</text>
                <input
                  className="editor-input"
                  placeholder="<h1>Welcome to my Net Slum site</h1>"
                  value={editorText}
                  bindinput={(e: LynxInputEvent) => setEditorText(e.detail.value)}
                />
                <view className="editor-actions">
                  <text className="primary-sm" bindtap={() => {
                    try {
                      NativeModules.NetslumHost.saveSiteFile("index.html", editorText || "<h1>Welcome to netslum</h1>", siteRevision);
                    } catch (e) {
                      void e;
                    }
                  }}>SAVE DRAFT</text>
                  <text className="secondary-sm" bindtap={() => {
                    try {
                      NativeModules.NetslumHost.publishSite(siteRevision);
                    } catch (e) {
                      void e;
                    }
                  }}>PUBLISH SITE LIVE</text>
                </view>
              </view>
            </view>
          </view>
        ) : (
          <view className="content">
            <text className="title">404 // NOT FOUND</text>
            <text className="primary" bindtap={() => navigate("/")}>RETURN TO NETSLUM &rarr;</text>
          </view>
        )}
        </scroll-view>
      </view>
    </page>
  );
}
