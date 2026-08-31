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
  profile?: string;
  actionStatus?: string;
  routeError?: string;
  feedStale?: boolean;
  compactViewport?: boolean;
  lastUpdatedAt?: number;
  editorChunk?: string;
  editorRevision?: string;
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
    readSiteFile(path: string, revision: string, offset: number): void;
    saveSiteFile(path: string, content: string, revision?: string): void;
    publishSite(revision: string): void;
  };
};

const EDITOR_CHUNK_CHARS = 1000;


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
  const [activePane, setActivePane] = useState<"world" | "feed">("world");
  const [editorPath, setEditorPath] = useState("index.html");
  const [editorText, setEditorText] = useState("");
  const [editorNextOffset, setEditorNextOffset] = useState(0);
  const [editorLoadedChars, setEditorLoadedChars] = useState(0);
  const [editorBaseRevision, setEditorBaseRevision] = useState("");
  const [sitePublishedUrl, setSitePublishedUrl] = useState("");
  const [handledStatusNonce, setHandledStatusNonce] = useState(0);
  useInitDataChanged((next) => {
    const updated = next as InitData;
    setData((current) => ({ ...current, ...updated }));

    if (updated.editorChunk) {
      try {
        const chunk = JSON.parse(updated.editorChunk) as { path: string; content: string; revision: string; nextOffset?: number };
        if (chunk.path === editorPath) {
          if (editorLoadedChars === 0 || chunk.revision !== editorBaseRevision) {
            setEditorText(chunk.content);
            setEditorLoadedChars(chunk.content.length);
          } else {
            setEditorText((current) => current + chunk.content);
            setEditorLoadedChars((current) => current + chunk.content.length);
          }
          setEditorBaseRevision(chunk.revision);
        }
      } catch (error) {
        void error;
      }
      return;
    }

    if (!updated.actionStatus) return;
    try {
      const status = JSON.parse(updated.actionStatus) as ActionStatus;
      if (status.nonce === handledStatusNonce) return;
      setHandledStatusNonce(status.nonce);
      if (status.state === "success" && status.action === "post") setPostText("");
      if (status.state === "success" && status.action === "zone") setNoteText("");
      if (status.state === "success" && status.action === "site" && status.message.startsWith("Site published")) {
        setSitePublishedUrl(status.message);
      }
      if (status.state === "success" && status.action === "site" && updated.editorRevision) {
        setEditorBaseRevision(updated.editorRevision);
      }
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

  const openFile = (path: string): void => {
    setEditorPath(path);
    setEditorNextOffset(0);
    setEditorLoadedChars(0);
    setEditorText("");
    try {
      NativeModules.NetslumHost.readSiteFile(path, "", 0);
    } catch (error) {
      void error;
    }
  };

  const loadMoreEditor = (): void => {
    try {
      NativeModules.NetslumHost.readSiteFile(editorPath, "", editorLoadedChars);
    } catch (error) {
      void error;
    }
  };

  const saveFile = (): void => {
    try {
      NativeModules.NetslumHost.saveSiteFile(editorPath, editorText, editorBaseRevision || siteRevision);
    } catch (error) {
      void error;
    }
  };

  const publishSite = (): void => {
    try {
      NativeModules.NetslumHost.publishSite(editorBaseRevision || siteRevision);
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

  let profile: { did: string; handle: string; displayName?: string; description?: string; siteUrl?: string | null } | null = null;
  try {
    if (data.profile) profile = JSON.parse(data.profile) as { did: string; handle: string; displayName?: string; description?: string; siteUrl?: string | null };
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
  const siteBusy = actionStatus?.action === "site" && actionStatus.state === "busy";
  const compact = data.compactViewport === true;
  const onZoneRoute = route === "/gate" || route.startsWith("/zone/");

  return (
    <page className={onZoneRoute ? "page page-zone" : "page"}>
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
          </view>
        ) : route === "/gate" || route.startsWith("/zone/") ? (
          <view className={compact ? "split-layout compact" : "split-layout"}>
            {compact ? (
              <view className="pane-tabs">
                <text className={activePane === "world" ? "pane-tab active" : "pane-tab"} bindtap={() => setActivePane("world")}>WORLD</text>
                <text className={activePane === "feed" ? "pane-tab active" : "pane-tab"} bindtap={() => setActivePane("feed")}>FEED</text>
              </view>
            ) : null}
            <view className={activePane === "world" || !compact ? "split-world" : "split-world pane-hidden"}>
              <text className="kicker">CHAOS GATE // WORLD</text>
              <text className="title">&Delta; {activeZoneKey}</text>
              <text className="copy">State Version {zoneVersion} &bull; {zoneObjects.length} Objects Active</text>
              <text className="zone-scene-hint">DETERMINISTIC SECTOR RENDER // SHA-256 SEEDED // ALL TRAVELERS SEE THE SAME SPACE</text>
            </view>
            <view className={activePane === "feed" || !compact ? "split-feed" : "split-feed pane-hidden"}>
              <text className="kicker">SECTOR RAIL</text>
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
          </view>
        ) : route === "/studio" ? (
          <view className="content">
            <text className="kicker">PERSONAL SITE STUDIO // @{siteSlug || "loading"}</text>
            <text className="title">programmable page editor</text>
            <text className="copy">Draft Revision: {siteRevision.slice(0, 16) || "none"}</text>
            {data.routeError ? <text className="stale-label">{data.routeError}</text> : null}

            <view className="studio-container">
              <view className="file-tree">
                <text className="tree-header">FILES ({siteFiles.length})</text>
                {siteFiles.map(f => (
                  <view key={f.path} className={editorPath === f.path ? "file-item file-item-active" : "file-item"} bindtap={() => openFile(f.path)}>
                    <text className="file-item-text">&bull; {f.path}</text>
                    <text className="file-item-size">{f.size} B</text>
                  </view>
                ))}
              </view>

              <view className="editor-panel">
                <text className="editor-label">EDITING {editorPath || "index.html"}</text>
                <input
                  className="editor-input"
                  placeholder="<h1>Welcome to my Net Slum site</h1>"
                  value={editorText}
                  bindinput={(e: LynxInputEvent) => setEditorText(e.detail.value)}
                />
                {editorNextOffset ? (
                  <text className="stale-label" bindtap={loadMoreEditor}>FILE TRUNCATED // TAP TO LOAD NEXT {EDITOR_CHUNK_CHARS} CHARS</text>
                ) : null}
                <view className="editor-actions">
                  <text className={siteBusy ? "primary-sm busy" : "primary-sm"} bindtap={saveFile}>SAVE DRAFT</text>
                  <text className="secondary-sm" bindtap={publishSite}>PUBLISH SITE LIVE</text>
                </view>
                {sitePublishedUrl ? (
                  <text className="stale-label">PUBLISHED // {sitePublishedUrl}</text>
                ) : null}
              </view>
            </view>
          </view>
        ) : route.startsWith("/profile/") ? (
          <view className="content">
            <text className="kicker">AT PROTOCOL IDENTITY</text>
            {profile ? (
              <view className="profile-card">
                <text className="title">@{profile.handle}</text>
                {profile.displayName ? <text className="profile-name">{profile.displayName}</text> : null}
                {profile.description ? <text className="profile-desc">{profile.description}</text> : null}
                <text className="profile-did">did: {profile.did}</text>
                {profile.siteUrl ? (
                  <text className="primary" bindtap={() => navigate(profile.siteUrl ?? "")}>
                    VISIT NETSLUM PAGE {profile.siteUrl} &rarr;
                  </text>
                ) : (
                  <text className="profile-desc">No published netslum page.</text>
                )}
              </view>
            ) : (
              <text className="copy">{data.routeError || "Resolving identity…"}</text>
            )}
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
