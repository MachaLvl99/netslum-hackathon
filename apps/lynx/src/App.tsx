import { useEffect, useInitData, useInitDataChanged, useState } from "@lynx-js/react";
import {
  DefaultHomePage,
  PersonalHomePage,
  ZonePage,
  DistrictPage,
  StudioPage,
  TimelinePage,
  NotificationsPage,
  MessagesPage,
  SearchPage,
  ProfilePage,
  ThreadPage,
  SettingsPage,
  NotFoundPage
} from "./pages/index.js";
import type {
  ActionStatus,
  FeedResultItem,
  HomeSettings,
  InitData,
  NotificationItem,
  PostItem,
  ProfileInfo,
  SiteFileInfo,
  ThreadItem,
  ZoneObjectItem
} from "./views/types.js";

declare let NativeModules: {
  NetslumHost: {
    navigate(route: string): void;
    logout(): void;
    sendDm(conversationId: string, text: string): void;
    startConversation(recipient: string): void;
    acceptDm(conversationId: string): void;
    muteDm(conversationId: string, mute: boolean): void;
    reactDm(conversationId: string, messageId: string, emoji: string, action: string): void;
    deleteDmForSelf(conversationId: string, messageId: string): void;
    runSearch(kind: string, query: string): void;
    postMessage(text: string, destination?: string, replyToUri?: string, replyToCid?: string): void;
    placeZoneNote(zoneKey: string, text: string): void;
    followUser(actor: string, follow: boolean): void;
    muteUser(actor: string, mute: boolean): void;
    blockUser(actor: string, block: boolean): void;
    updateProfile(inputJson: string): void;
    reactToPost(uri: string, cid: string, action: string): void;
    loadThread(uri: string): void;
    setDmAgentEnabled(enabled: boolean): void;
    saveHomeSettings(mode: string, activeHomePath: string | null): void;
    updateChatDeclaration(allowIncoming: string): void;
    markNotificationsSeen(): void;
    openUrl(url: string): void;
    appReady(): void;
    goBack(): void;
    uploadAvatar(): void;
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
  const [destination, setDestination] = useState<"town" | "bluesky">("town");
  const [noteText, setNoteText] = useState("");
  const [activePane, setActivePane] = useState<"world" | "feed">("world");
  const [handledStatusNonce, setHandledStatusNonce] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelinePosts, setTimelinePosts] = useState<PostItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [conversationList, setConversationList] = useState<Array<{ convoId: string; lastMessageText?: string; unreadCount: number; otherHandle?: string; muted?: boolean; status?: "accepted" | "request" }>>([]);
  const [activeMessages, setActiveMessages] = useState<Array<{ id: string; text: string; senderDid: string; sentAt?: string; reactions?: Array<{ value: string; count: number }> }>>([]);
  const [pendingComposeRecipient, setPendingComposeRecipient] = useState<string | null>(null);
  const [dmSending, setDmSending] = useState(false);
  const [dmDraft, setDmDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchKind, setSearchKind] = useState<"posts" | "actors" | "feeds">("posts");
  const [actorHandles, setActorHandles] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PostItem[]>([]);
  const [authorPosts, setAuthorPosts] = useState<PostItem[]>([]);
  const [feedResults, setFeedResults] = useState<FeedResultItem[]>([]);
  const [threadData, setThreadData] = useState<ThreadItem | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replying, setReplying] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [homeSettings, setHomeSettings] = useState<HomeSettings | null>(null);

  useInitDataChanged((next) => {
    const updated = next as InitData;
    setData((current) => ({ ...current, ...updated }));

    if (updated.timeline !== undefined) {
      const page = parseJson<{ posts?: PostItem[] }>(updated.timeline);
      setTimelinePosts(page?.posts ?? []);
      setTimelineLoading(false);
    }
    if (updated.notifications !== undefined) {
      const page = parseJson<{ notifications?: NotificationItem[] }>(updated.notifications);
      setNotifications(page?.notifications ?? []);
      setTimelineLoading(false);
    }
    if (updated.conversations !== undefined) {
      const page = parseJson<{ convos?: Array<{ convoId: string; lastMessageText?: string; unreadCount: number; otherHandle?: string; muted?: boolean; status?: "accepted" | "request" }> }>(updated.conversations);
      setConversationList(page?.convos ?? []);
      setTimelineLoading(false);
    }
    if (updated.composeRecipient !== undefined) {
      setPendingComposeRecipient(updated.composeRecipient || null);
    }
    if (updated.messages !== undefined) {
      const page = parseJson<{ messages?: Array<{ id: string; text: string; senderDid: string; sentAt?: string; reactions?: Array<{ value: string; count: number }> }> }>(updated.messages);
      setActiveMessages(page?.messages ?? []);
      setTimelineLoading(false);
    }
    if (updated.actorHandles !== undefined) {
      setActorHandles(parseJson<string[]>(updated.actorHandles) ?? []);
      setSearching(false);
    }
    if (updated.authorPosts !== undefined) {
      setAuthorPosts(parseJson<PostItem[]>(updated.authorPosts) ?? []);
    }
    if (updated.searchPosts !== undefined) {
      const page = parseJson<{ posts?: PostItem[] }>(updated.searchPosts);
      setSearchResults(page?.posts ?? []);
      setSearching(false);
    }
    if (updated.searchFeeds !== undefined) {
      const page = parseJson<{ feeds?: FeedResultItem[] }>(updated.searchFeeds);
      setFeedResults(page?.feeds ?? []);
      setSearching(false);
    }
    if (updated.thread !== undefined) {
      const parsed = parseJson<ThreadItem>(updated.thread);
      setThreadData(parsed);
      setThreadLoading(false);
    }
    if (updated.homeSettings !== undefined) {
      const parsed = parseJson<HomeSettings>(updated.homeSettings);
      setHomeSettings(parsed);
    }



    if (!updated.actionStatus) return;
    const status = parseJson<ActionStatus>(updated.actionStatus);
    if (!status || status.nonce === handledStatusNonce) return;
    setHandledStatusNonce(status.nonce);
    if (status.action === "post" && status.state === "success") {
      setPostText("");
      setReplyDraft("");
      setReplying(false);
    }
    if (status.action === "post" && status.state === "error") {
      setReplying(false);
    }
    if (status.action === "zone" && status.state === "success") setNoteText("");
    if (status.action === "message" && status.state !== "busy") {
      setDmSending(false);
      if (status.state === "success") setDmDraft("");
    }
    if (status.action === "search" && status.state !== "busy") setSearching(false);
    if (status.action === "profile" && status.state !== "busy") setProfileSaving(false);

  });

  // Signal the host that the React tree (including useInitDataChanged above)
  // is mounted. host.ts gates all pushData on this — data only flows after
  // the listener provably exists, eliminating the lost-delta race.
  useEffect(() => {
    try { NativeModules.NetslumHost.appReady(); } catch { /* bridge call */ }
  }, []);

  const navigate = (route: string): void => {
    try { NativeModules.NetslumHost.navigate(route); } catch (e) { void e; }
  };

  const logout = (): void => {
    try { NativeModules.NetslumHost.logout(); } catch (e) { void e; }
  };

  const submitPost = (): void => {
    if (!postText.trim() || postText.length > 290) return;
    try { NativeModules.NetslumHost.postMessage(postText, destination); } catch (error) { void error; }
  };

  const submitNote = (zoneKey: string): void => {
    if (!noteText.trim() || noteText.length > 280) return;
    try { NativeModules.NetslumHost.placeZoneNote(zoneKey, noteText); } catch (error) { void error; }
  };


  const goBack = (): void => {
    try { NativeModules.NetslumHost.goBack(); } catch { navigate("/"); }
  };


  const sendDm = (): void => {
    if (!dmDraft || !routeConvoId || dmSending) return;
    setDmSending(true);
    try {
      NativeModules.NetslumHost.sendDm(routeConvoId, dmDraft);
    } catch (error) {
      void error;
      setDmSending(false);
    }
  };
  const startConversation = (recipient: string): void => {
    setPendingComposeRecipient(null);
    try { NativeModules.NetslumHost.startConversation(recipient); } catch (error) { void error; }
  };


  const acceptDm = (convoId: string): void => {
    try { NativeModules.NetslumHost.acceptDm(convoId); } catch (error) { void error; }
  };

  const muteDm = (convoId: string, mute: boolean): void => {
    try { NativeModules.NetslumHost.muteDm(convoId, mute); } catch (error) { void error; }
  };

  const reactDm = (convoId: string, messageId: string, emoji: string, action: "add" | "remove"): void => {
    try { NativeModules.NetslumHost.reactDm(convoId, messageId, emoji, action); } catch (error) { void error; }
  };

  const deleteDmForSelf = (convoId: string, messageId: string): void => {
    try { NativeModules.NetslumHost.deleteDmForSelf(convoId, messageId); } catch (error) { void error; }
  };

  const runSearch = (): void => {
    if (!searchQuery) return;
    setSearching(true);
    try {
      NativeModules.NetslumHost.runSearch(searchKind, searchQuery);
    } catch (error) {
      void error;
      setSearching(false);
    }
  };

  const followUser = (actor: string, follow: boolean): void => {
    try { NativeModules.NetslumHost.followUser(actor, follow); } catch (error) { void error; }
  };

  const muteUser = (actor: string, mute: boolean): void => {
    try { NativeModules.NetslumHost.muteUser(actor, mute); } catch (error) { void error; }
  };

  const blockUser = (actor: string, block: boolean): void => {
    try { NativeModules.NetslumHost.blockUser(actor, block); } catch (error) { void error; }
  };

  const saveProfile = (input: { displayName?: string | undefined; description?: string | undefined; swapRecord?: string | undefined }): void => {
    setProfileSaving(true);
    try {
      NativeModules.NetslumHost.updateProfile(JSON.stringify(input));
    } catch (error) {
      void error;
      setProfileSaving(false);
    }
  };

  const reactToPost = (uri: string, cid: string, action: string): void => {
    try { NativeModules.NetslumHost.reactToPost(uri, cid, action); } catch (error) { void error; }
  };

  const sendReply = (): void => {
    if (!replyDraft.trim() || replying || !threadData?.post) return;
    setReplying(true);
    try {
      NativeModules.NetslumHost.postMessage(replyDraft, "town", threadData.post.uri, threadData.post.cid);
    } catch (error) {
      void error;
      setReplying(false);
    }
  };

  const toggleDmAgent = (enabled: boolean): void => {
    try { NativeModules.NetslumHost.setDmAgentEnabled(enabled); } catch (error) { void error; }
  };

  const saveHomeSettings = (mode: string, activeHomePath: string | null): void => {
    try { NativeModules.NetslumHost.saveHomeSettings(mode, activeHomePath); } catch (error) { void error; }
  };

  const updateChatDeclaration = (allowIncoming: "all" | "following" | "none"): void => {
    try { NativeModules.NetslumHost.updateChatDeclaration(allowIncoming); } catch (error) { void error; }
  };

  const markNotificationsSeen = (): void => {
    try { NativeModules.NetslumHost.markNotificationsSeen(); } catch (error) { void error; }
  };

  const route = data.route ?? "/";
  const activeZoneKey = route.startsWith("/zone/") ? route.slice(6) : "hidden.archive.echo";
  const routeConvoId = route.startsWith("/messages/") && route !== "/messages/requests"
    ? decodeURIComponent(route.slice("/messages/".length))
    : null;

  const feedData = parseJson<{ posts?: PostItem[] }>(data.feed);
  const posts: PostItem[] = feedData?.posts ?? [];

  const zoneData = parseJson<{ objects?: ZoneObjectItem[]; version?: number }>(data.zone);
  const zoneObjects: ZoneObjectItem[] = zoneData?.objects ?? [];
  const zoneVersion = zoneData?.version ?? 0;

  const siteData = parseJson<{ slug?: string; revision?: string; files?: SiteFileInfo[]; activeRevision?: string | null; isStarter?: boolean }>(data.site);
  const siteSlug = siteData?.slug ?? "";

  const profile = parseJson<ProfileInfo>(data.profile);
  const actionStatus = parseJson<ActionStatus>(data.actionStatus);
  const postBusy = actionStatus?.action === "post" && actionStatus.state === "busy";
  const zoneBusy = actionStatus?.action === "zone" && actionStatus.state === "busy";
  const compact = data.compactViewport === true;
  const onZoneRoute = route === "/gate" || route.startsWith("/zone/");

  return (
    <page className={onZoneRoute ? "page page-zone" : "page"}>
      <view className="shell">
        <view className="header">
          <text className="wordmark" accessibility-label="netslum home" bindtap={() => navigate("/")}>netslum</text>
          {(route.startsWith("/post/") || route.startsWith("/profile/") || route.startsWith("/@") || route.startsWith("/district/") || (route.startsWith("/messages/") && route !== "/messages" && !route.endsWith("/requests"))) ? (
            <text className="back-link" bindtap={goBack}>&larr; back</text>
          ) : null}
          {data.canPublishSite ? (
            <text className={route === "/studio" ? "nav-item active" : "nav-item"} accessibility-label="open site studio" bindtap={() => navigate("/studio")}>studio</text>
          ) : null}
          <text className={route === "/notifications" ? "nav-icon active" : "nav-icon"} accessibility-label="open alerts" bindtap={() => navigate("/notifications")}>&#128276;</text>
          <text className={route === "/messages" || route.startsWith("/messages/") ? "nav-icon active" : "nav-icon"} accessibility-label="open mail" bindtap={() => navigate("/messages")}>&#9993;</text>
          <text className={route === "/search" ? "nav-icon active" : "nav-icon"} accessibility-label="open search" bindtap={() => navigate("/search")}>&#128269;</text>
          {data.authenticated ? (
            <text className={route === "/settings" ? "nav-icon active" : "nav-icon"} accessibility-label="open settings" bindtap={() => navigate("/settings")}>&#9881;</text>
          ) : null}
          <view className="header-right">
            {data.authenticated ? (
              <view className="user-badge">
                {data.headerAvatar ? (
                  <image className="header-avatar" src={data.headerAvatar} mode="aspectFill" />
                ) : null}
                <text className="user-handle" accessibility-label="open your profile" bindtap={() => navigate(`/profile/${data.did ?? data.handle}`)}>{data.displayHandle ?? `@${data.handle ?? "connected"}`}</text>
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
        {route === "/" || route === "/town" || route === "/world" || route === "/dashboard" || route.startsWith("/?") || route.startsWith("/dashboard?") || route.startsWith("/world?") ? (
          data.authenticated && route !== "/world" && route !== "/town" && !route.includes("mode=world") ? (
            <PersonalHomePage
              handle={data.handle}
              displayHandle={data.displayHandle}
              did={data.did}
              avatarUrl={data.headerAvatar}
              feedPosts={posts}
              timelinePosts={timelinePosts}
              unreadDmCount={conversationList.reduce((acc, c) => acc + c.unreadCount, 0)}
              homeLayout={data.homeLayout}
              onNavigate={navigate}
              compactViewport={compact}
            />
          ) : (
            <DefaultHomePage
              authenticated={data.authenticated === true}
              navigate={navigate}
              feedStale={data.feedStale === true}
              destination={destination}
              setDestination={setDestination}
              postText={postText}
              setPostText={setPostText}
              postBusy={postBusy}
              submitPost={submitPost}
              posts={posts}
              onReact={reactToPost}
            />
          )
        ) : route === "/gate" || route.startsWith("/zone/") ? (
          <ZonePage
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
        ) : route.startsWith("/district/") ? (
          <DistrictPage
            slug={route.slice(10).split("?")[0] ?? ""}
            routeError={data.routeError}
            navigate={navigate}
          />
        ) : route === "/studio" ? (
          <StudioPage
            siteSlug={siteSlug}
            hasContent={!!siteData?.activeRevision || ((siteData?.files?.length ?? 0) > 0 && siteData.isStarter !== true)}
            routeError={data.routeError}
            navigate={navigate}
          />
        ) : route === "/timeline" ? (
          <TimelinePage posts={timelinePosts} loading={timelineLoading} onReact={reactToPost} navigate={navigate} />
        ) : route === "/notifications" ? (
          <NotificationsPage notifications={notifications} loading={timelineLoading} onMarkSeen={markNotificationsSeen} navigate={navigate} />
        ) : route === "/messages" || route.startsWith("/messages/") ? (
          <MessagesPage
            key={route}
            conversations={conversationList}
            messages={activeMessages}
            activeConvoId={routeConvoId}
            draft={dmDraft}
            sending={dmSending}
            activeTab={route.endsWith("/requests") ? "requests" : "inbox"}
            initialRecipient={pendingComposeRecipient ?? undefined}
            onTabChange={(tab) => navigate(tab === "requests" ? "/messages/requests" : "/messages")}
            onSelectConversation={(convoId) => navigate(`/messages/${convoId}`)}
            onDraftChange={setDmDraft}
            onSend={sendDm}
            onStartConversation={startConversation}
            onAccept={acceptDm}
            onMute={muteDm}
            onReact={reactDm}
            onDeleteForSelf={deleteDmForSelf}
            authenticated={data.authenticated === true}
            onLogin={() => navigate("/oauth/login")}
          />
        ) : route === "/search" ? (
          <SearchPage
            onQueryChange={setSearchQuery}
            feeds={feedResults}
            searchKind={searchKind}
            onSearchKindChange={setSearchKind}
            posts={searchResults}
            actorHandles={actorHandles}
            searching={searching}
            onSearch={runSearch}
            navigate={navigate}
          />
        ) : route.startsWith("/profile/") || (route.startsWith("/@") && !route.startsWith("/@netslum")) ? (
          <ProfilePage
            profile={profile}
            viewerDid={data.did}
            authorPosts={authorPosts}
            publicPageSchema={data.publicPageSchema}
            routeError={data.routeError}
            navigate={navigate}
            onFollow={followUser}
            onMute={muteUser}
            onBlock={blockUser}
            onSaveProfile={saveProfile}
            savingProfile={profileSaving}
          />
        ) : route.startsWith("/post/") ? (
          <ThreadPage
            thread={threadData}
            loading={threadLoading}
            routeError={data.routeError}
            authenticated={data.authenticated === true}
            replyDraft={replyDraft}
            onReplyDraftChange={setReplyDraft}
            onSendReply={sendReply}
            replying={replying}
            onReact={reactToPost}
            navigate={navigate}
          />
        ) : route === "/settings" ? (
          <SettingsPage
            authenticated={data.authenticated === true}
            did={data.did}
            handle={data.handle}
            canPublishSite={data.canPublishSite}
            canAuthorHome={data.canAuthorHome}
            canUseDms={data.canUseDms}
            canUploadVideo={data.canUploadVideo}
            dmAgentEnabled={data.dmAgentEnabled}
            scopeVersion={data.scopeVersion}
            reauthorizeRequired={data.reauthorizeRequired}
            homeSettings={homeSettings}
            chatDeclaration={data.chatDeclaration}
            onToggleDmAgent={toggleDmAgent}
            onUpdateChatDeclaration={updateChatDeclaration}
            onSaveHomeSettings={saveHomeSettings}
            onLogout={logout}
            navigate={navigate}
          />
        ) : (
          <NotFoundPage navigate={navigate} />
        )}
        </scroll-view>
      </view>
    </page>
  );
}
