import { useInitData, useInitDataChanged, useState } from "@lynx-js/react";
import { HomeView } from "./views/HomeView.jsx";
import { NotFoundView } from "./views/NotFoundView.jsx";
import { ProfileView } from "./views/ProfileView.jsx";
import { StudioView } from "./views/StudioView.jsx";
import { TownView } from "./views/TownView.jsx";
import { ZoneView } from "./views/ZoneView.jsx";
import type { ActionStatus, InitData, PostItem, ProfileInfo, SiteFileInfo, ZoneObjectItem } from "./views/types.js";

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

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

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
    const status = parseJson<ActionStatus>(updated.actionStatus);
    if (!status || status.nonce === handledStatusNonce) return;
    setHandledStatusNonce(status.nonce);
    if (status.state === "success" && status.action === "post") setPostText("");
    if (status.state === "success" && status.action === "zone") setNoteText("");
    if (status.state === "success" && status.action === "site" && status.message.startsWith("Site published")) {
      setSitePublishedUrl(status.message);
    }
    if (status.state === "success" && status.action === "site" && updated.editorRevision) {
      setEditorBaseRevision(updated.editorRevision);
    }
  });

  const navigate = (route: string): void => {
    try { NativeModules.NetslumHost.navigate(route); } catch (e) { void e; }
  };

  const logout = (): void => {
    try { NativeModules.NetslumHost.logout(); } catch (e) { void e; }
  };

  const submitPost = (): void => {
    if (!postText.trim() || postText.length > 290) return;
    try { NativeModules.NetslumHost.postMessage(postText); } catch (error) { void error; }
  };

  const submitNote = (zoneKey: string): void => {
    if (!noteText.trim() || noteText.length > 280) return;
    try { NativeModules.NetslumHost.placeZoneNote(zoneKey, noteText); } catch (error) { void error; }
  };

  const openFile = (path: string): void => {
    setEditorPath(path);
    setEditorNextOffset(0);
    setEditorLoadedChars(0);
    setEditorText("");
    try { NativeModules.NetslumHost.readSiteFile(path, "", 0); } catch (error) { void error; }
  };

  const loadMoreEditor = (): void => {
    try { NativeModules.NetslumHost.readSiteFile(editorPath, "", editorLoadedChars); } catch (error) { void error; }
  };

  const saveFile = (): void => {
    try { NativeModules.NetslumHost.saveSiteFile(editorPath, editorText, editorBaseRevision || siteRevision); } catch (error) { void error; }
  };

  const publishSite = (): void => {
    try { NativeModules.NetslumHost.publishSite(editorBaseRevision || siteRevision); } catch (error) { void error; }
  };

  const route = data.route ?? "/";
  const activeZoneKey = route.startsWith("/zone/") ? route.slice(6) : "hidden.archive.echo";

  const feedData = parseJson<{ posts?: PostItem[] }>(data.feed);
  const posts: PostItem[] = feedData?.posts ?? [];

  const zoneData = parseJson<{ objects?: ZoneObjectItem[]; version?: number }>(data.zone);
  const zoneObjects: ZoneObjectItem[] = zoneData?.objects ?? [];
  const zoneVersion = zoneData?.version ?? 0;

  const siteData = parseJson<{ slug?: string; revision?: string; files?: SiteFileInfo[] }>(data.site);
  const siteSlug = siteData?.slug ?? "";
  const siteRevision = siteData?.revision ?? "";
  const siteFiles: SiteFileInfo[] = siteData?.files ?? [];

  const profile = parseJson<ProfileInfo>(data.profile);
  const actionStatus = parseJson<ActionStatus>(data.actionStatus);
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
          <HomeView authenticated={data.authenticated === true} navigate={navigate} />
        ) : route === "/town" ? (
          <TownView
            compact={compact}
            activePane={activePane}
            setActivePane={setActivePane}
            authenticated={data.authenticated === true}
            feedStale={data.feedStale === true}
            postText={postText}
            setPostText={setPostText}
            postBusy={postBusy}
            submitPost={submitPost}
            posts={posts}
            navigate={navigate}
          />
        ) : route === "/gate" || route.startsWith("/zone/") ? (
          <ZoneView
            compact={compact}
            activePane={activePane}
            setActivePane={setActivePane}
            activeZoneKey={activeZoneKey}
            zoneVersion={zoneVersion}
            zoneObjects={zoneObjects}
            authenticated={data.authenticated === true}
            noteText={noteText}
            setNoteText={setNoteText}
            zoneBusy={zoneBusy}
            submitNote={submitNote}
            navigate={navigate}
          />
        ) : route === "/studio" ? (
          <StudioView
            siteSlug={siteSlug}
            siteRevision={siteRevision}
            routeError={data.routeError}
            siteFiles={siteFiles}
            editorPath={editorPath}
            editorText={editorText}
            setEditorText={setEditorText}
            editorNextOffset={editorNextOffset}
            loadMoreEditor={loadMoreEditor}
            openFile={openFile}
            siteBusy={siteBusy}
            saveFile={saveFile}
            publishSite={publishSite}
            sitePublishedUrl={sitePublishedUrl}
          />
        ) : route.startsWith("/profile/") ? (
          <ProfileView profile={profile} routeError={data.routeError} navigate={navigate} />
        ) : (
          <NotFoundView navigate={navigate} />
        )}
        </scroll-view>
      </view>
    </page>
  );
}