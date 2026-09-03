import { state, pushData, flushPendingData } from "./state.js";
import { apiJson, describeFailure, getSession, invalidateSessionCache, mutationHeaders, setStatus } from "./api.js";
import { navigate, syncRoute } from "./router.js";
import { refreshTown, refreshZone } from "./liveUpdates.js";
import { handlePlayVideo } from "./media.js";
import type { ZonePayload } from "./types.js";
import { ApiFailure } from "./types.js";

export function createBridgeBlobUrl(): string {
  const code = `export default function(_nativeModules, nativeModulesCall) {
    return {
      navigate(route) { return nativeModulesCall("navigate", { route }); },
      logout() { return nativeModulesCall("logout", {}); },
      postMessage(text, destination, replyToUri, replyToCid) { return nativeModulesCall("postMessage", { text, destination, replyToUri, replyToCid }); },
      placeZoneNote(zoneKey, text) { return nativeModulesCall("placeZoneNote", { zoneKey, text }); },

      startConversation(recipient) { return nativeModulesCall("startConversation", { recipient }); },
      updateChatDeclaration(allowIncoming) { return nativeModulesCall("updateChatDeclaration", { allowIncoming }); },
      sendDm(conversationId, text) { return nativeModulesCall("sendDm", { conversationId, text }); },
      acceptDm(conversationId) { return nativeModulesCall("acceptDm", { conversationId }); },
      muteDm(conversationId, mute) { return nativeModulesCall("muteDm", { conversationId, mute }); },
      reactDm(conversationId, messageId, emoji, action) { return nativeModulesCall("reactDm", { conversationId, messageId, emoji, action }); },
      deleteDmForSelf(conversationId, messageId) { return nativeModulesCall("deleteDmForSelf", { conversationId, messageId }); },
      runSearch(kind, query) { return nativeModulesCall("runSearch", { kind, query }); },
      followUser(actor, follow) { return nativeModulesCall("followUser", { actor, follow }); },
      muteUser(actor, mute) { return nativeModulesCall("muteUser", { actor, mute }); },
      blockUser(actor, block) { return nativeModulesCall("blockUser", { actor, block }); },
      updateProfile(inputJson) { return nativeModulesCall("updateProfile", { inputJson }); },
      reactToPost(uri, cid, action) { return nativeModulesCall("reactToPost", { uri, cid, action }); },
      loadThread(uri) { return nativeModulesCall("loadThread", { uri }); },
      setDmAgentEnabled(enabled) { return nativeModulesCall("setDmAgentEnabled", { enabled }); },
      saveHomeSettings(mode, activeHomePath) { return nativeModulesCall("saveHomeSettings", { mode, activeHomePath }); },
      markNotificationsSeen() { return nativeModulesCall("markNotificationsSeen", {}); },
      openUrl(url) { return nativeModulesCall("openUrl", { url }); },
      playVideo(playlist, thumbnail, alt, key) { return nativeModulesCall("playVideo", { playlist, thumbnail, alt, key }); },
      goBack() { return nativeModulesCall("goBack", {}); },
      appReady() { return nativeModulesCall("appReady", {}); },
      uploadAvatar() { return nativeModulesCall("uploadAvatar", {}); }
    };
  }`;

  return URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
}

export async function handleNativeModulesCall(name: string, data: unknown, moduleName: string): Promise<void> {
  if (moduleName !== "NetslumHost") return;
  const input = data as Record<string, unknown> | undefined;

  if (name === "navigate" && typeof input?.route === "string") {
    navigate(input.route);
    return;
  }

  if (name === "openUrl" && typeof input?.url === "string") {
    if (input.url.startsWith("https://")) window.open(input.url, "_blank", "noopener,noreferrer");
    return;
  }

  if (name === "playVideo" && typeof input?.playlist === "string") {
    handlePlayVideo({
      playlist: input.playlist,
      thumbnail: typeof input.thumbnail === "string" ? input.thumbnail : undefined,
      alt: typeof input.alt === "string" ? input.alt : undefined,
      key: typeof input.key === "string" ? input.key : undefined
    });
    return;
  }

  if (name === "appReady") {
    // Always flush + re-push session: guaranteed listener attachment signal
    state.viewReady = true;
    flushPendingData();
    void getSession()
      .then((session) => {
        pushData({ route: location.pathname + location.search, ...session });
      })
      .catch(() => undefined);
    return;
  }

  if (name === "goBack") {
    if (history.length > 1) history.back();
    else navigate("/town");
    return;
  }

  if (name === "logout") {
    setStatus("logout", "busy", "Signing out…");
    try {
      await apiJson("/api/auth/logout", { method: "POST", headers: mutationHeaders() });
      invalidateSessionCache();
      setStatus("logout", "success", "Signed out");
      navigate("/");
    } catch (error) {
      setStatus("logout", "error", describeFailure(error));
    }
    return;
  }

  if (name === "postMessage" && typeof input?.text === "string") {
    setStatus("post", "busy", "Preparing broadcast…");
    try {
      const prepare = (expectedRevision: string | null) =>
        apiJson<{ draftRevision: string }>("/api/post-draft", {
          method: "PUT",
          headers: mutationHeaders(),
          body: JSON.stringify({
            text: input.text,
            expectedRevision,
            ...(typeof input.destination === "string" && (input.destination === "town" || input.destination === "bluesky")
              ? { destination: input.destination }
              : {}),
            ...(typeof input.replyToUri === "string"
              ? { replyToUri: input.replyToUri, replyToCid: typeof input.replyToCid === "string" ? input.replyToCid : undefined }
              : {})
          })
        });
      let draft: { draftRevision: string };
      try {
        draft = await prepare(null);
      } catch (error) {
        const currentRevision = error instanceof ApiFailure ? error.payload.data?.currentRevision : undefined;
        if (!(error instanceof ApiFailure) || error.payload.code !== "STALE_REVISION" || !currentRevision) throw error;
        draft = await prepare(currentRevision);
      }
      setStatus("post", "busy", "Publishing to AT Protocol…");
      await apiJson("/api/posts/publish", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ draftRevision: draft.draftRevision })
      });
      setStatus("post", "success", "Broadcast published");
      if (typeof input.replyToUri === "string") {
        const thread = await apiJson<Record<string, unknown>>(`/api/post-thread?uri=${encodeURIComponent(input.replyToUri)}`);
        pushData({ thread: JSON.stringify(thread) });
      } else {
        await refreshTown();
      }
    } catch (error) {
      setStatus("post", "error", describeFailure(error));
    }
    return;
  }

  if (name === "placeZoneNote" && typeof input?.zoneKey === "string" && typeof input?.text === "string") {
    setStatus("zone", "busy", "Dropping note…");
    try {
      const zoneKey = input.zoneKey;
      const zone =
        state.latestZone?.zoneKey === zoneKey
          ? state.latestZone
          : await apiJson<ZonePayload>(`/api/zones/${encodeURIComponent(zoneKey)}`);
      await apiJson(`/api/zones/${encodeURIComponent(zoneKey)}/mutations`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          expectedVersion: zone.version,
          operations: [
            {
              op: "place",
              object: {
                type: "note",
                x: Math.floor(Math.random() * 800) + 100,
                y: Math.floor(Math.random() * 800) + 100,
                text: input.text
              }
            }
          ]
        })
      });
      setStatus("zone", "success", "Note dropped");
      await refreshZone(zoneKey);
    } catch (error) {
      setStatus("zone", "error", describeFailure(error));
    }
    return;
  }

  if (name === "startConversation" && typeof input?.recipient === "string") {
    setStatus("message", "busy", `Resolving ${input.recipient}…`);
    try {
      const data = await apiJson<{
        convo: { id: string; members?: Array<{ did?: string; handle?: string }> };
        recipientDid: string;
        handle?: string;
      }>("/api/dms/start", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ recipient: input.recipient })
      });
      const convoId = data.convo.id;
      if (data.recipientDid) {
        state.conversationRecipients.set(convoId, [data.recipientDid]);
      }
      setStatus("message", "success", "Conversation ready");
      navigate(`/messages/${convoId}`);
    } catch (error) {
      setStatus("message", "error", describeFailure(error));
    }
    return;
  }

  if (name === "sendDm" && typeof input?.conversationId === "string" && typeof input?.text === "string") {
    setStatus("message", "busy", "Preparing message…");
    try {
      const recipientDids = state.conversationRecipients.get(input.conversationId);
      if (!recipientDids || recipientDids.length === 0) {
        setStatus("message", "error", "Conversation members not loaded yet — reopen the conversation and retry");
        return;
      }
      const prepared = await apiJson<{ revision: string }>("/api/dms/prepare", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          convoId: input.conversationId,
          recipientDids,
          text: input.text
        })
      });
      setStatus("message", "busy", "Sending prepared message…");
      await apiJson("/api/dms/send", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ revision: prepared.revision })
      });
      setStatus("message", "success", "Message sent");
      const data = await apiJson<{ messages: Array<Record<string, unknown>> }>(
        `/api/dms/messages?convoId=${encodeURIComponent(input.conversationId)}`
      );
      const rawMessages = data.messages as Array<{
        id?: string;
        text?: string;
        sender?: { did?: string };
        reactions?: unknown[];
        sentAt?: string;
      }>;
      const messages = rawMessages.flatMap((message) => {
        if (typeof message.id !== "string" || typeof message.text !== "string") return [];
        const senderDid = typeof message.sender?.did === "string" ? message.sender.did : "";
        return [
          {
            id: message.id,
            text: message.text,
            senderDid,
            reactions: Array.isArray(message.reactions) ? message.reactions : undefined,
            ...(typeof message.sentAt === "string" ? { sentAt: message.sentAt } : {})
          }
        ];
      });
      pushData({ messages: JSON.stringify({ messages }) });
    } catch (error) {
      setStatus("message", "error", describeFailure(error));
    }
    return;
  }

  if (name === "acceptDm" && typeof input?.conversationId === "string") {
    setStatus("message", "busy", "Accepting conversation request…");
    try {
      await apiJson("/api/dms/accept", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ convoId: input.conversationId })
      });
      setStatus("message", "success", "Conversation request accepted");
      await syncRoute();
    } catch (error) {
      setStatus("message", "error", describeFailure(error));
    }
    return;
  }

  if (name === "muteDm" && typeof input?.conversationId === "string" && typeof input?.mute === "boolean") {
    try {
      await apiJson("/api/dms/mute", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ convoId: input.conversationId, mute: input.mute })
      });
      setStatus("message", "success", input.mute ? "Conversation muted" : "Conversation unmuted");
      await syncRoute();
    } catch (error) {
      setStatus("message", "error", describeFailure(error));
    }
    return;
  }

  if (
    name === "reactDm" &&
    typeof input?.convoId === "string" &&
    typeof input?.messageId === "string" &&
    typeof input?.emoji === "string" &&
    typeof input?.action === "string"
  ) {
    try {
      await apiJson("/api/dms/react", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ convoId: input.convoId, messageId: input.messageId, emoji: input.emoji, action: input.action })
      });
      const data = await apiJson<{ messages: Array<Record<string, unknown>> }>(
        `/api/dms/messages?convoId=${encodeURIComponent(input.convoId)}`
      );
      const rawMessages = data.messages as Array<{
        id?: string;
        text?: string;
        sender?: { did?: string };
        reactions?: unknown[];
        sentAt?: string;
      }>;
      const messages = rawMessages.flatMap((message) => {
        if (typeof message.id !== "string" || typeof message.text !== "string") return [];
        const senderDid = typeof message.sender?.did === "string" ? message.sender.did : "";
        return [
          {
            id: message.id,
            text: message.text,
            senderDid,
            reactions: Array.isArray(message.reactions) ? message.reactions : undefined,
            ...(typeof message.sentAt === "string" ? { sentAt: message.sentAt } : {})
          }
        ];
      });
      pushData({ messages: JSON.stringify({ messages }) });
    } catch (error) {
      setStatus("message", "error", describeFailure(error));
    }
    return;
  }

  if (name === "deleteDmForSelf" && typeof input?.conversationId === "string" && typeof input?.messageId === "string") {
    try {
      await apiJson("/api/dms/delete-for-self", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ convoId: input.conversationId, messageId: input.messageId })
      });
      setStatus("message", "success", "Message deleted for self");
      const data = await apiJson<{ messages: Array<Record<string, unknown>> }>(
        `/api/dms/messages?convoId=${encodeURIComponent(input.conversationId)}`
      );
      const rawMessages = data.messages as Array<{
        id?: string;
        text?: string;
        sender?: { did?: string };
        reactions?: unknown[];
        sentAt?: string;
      }>;
      const messages = rawMessages.flatMap((message) => {
        if (typeof message.id !== "string" || typeof message.text !== "string") return [];
        const senderDid = typeof message.sender?.did === "string" ? message.sender.did : "";
        return [
          {
            id: message.id,
            text: message.text,
            senderDid,
            reactions: Array.isArray(message.reactions) ? message.reactions : undefined,
            ...(typeof message.sentAt === "string" ? { sentAt: message.sentAt } : {})
          }
        ];
      });
      pushData({ messages: JSON.stringify({ messages }) });
    } catch (error) {
      setStatus("message", "error", describeFailure(error));
    }
    return;
  }

  if (name === "runSearch" && typeof input?.kind === "string" && typeof input?.query === "string") {
    setStatus("search", "busy", "Searching…");
    try {
      if (input.kind === "posts") {
        const data = await apiJson<{ posts: Array<Record<string, unknown>> }>(
          `/api/search/posts?q=${encodeURIComponent(input.query)}`
        );
        pushData({ searchPosts: JSON.stringify(data) });
      } else if (input.kind === "actors") {
        const data = await apiJson<{ actors: Array<{ did: string; handle: string }> }>(
          `/api/search/actors?q=${encodeURIComponent(input.query)}`
        );
        pushData({ actorHandles: JSON.stringify(data.actors.map((actor) => actor.handle)) });
      } else if (input.kind === "feeds") {
        const data = await apiJson<{ feeds: Array<Record<string, unknown>> }>(
          `/api/search/feeds?q=${encodeURIComponent(input.query)}`
        );
        pushData({ searchFeeds: JSON.stringify(data) });
      }
      setStatus("search", "success", "Done");
    } catch (error) {
      setStatus("search", "error", describeFailure(error));
    }
    return;
  }

  if (name === "updateChatDeclaration" && typeof input?.allowIncoming === "string") {
    setStatus("settings", "busy", "Updating DM privacy…");
    try {
      const data = await apiJson<{ allowIncoming: string }>("/api/settings/chat-declaration", {
        method: "PUT",
        headers: mutationHeaders(),
        body: JSON.stringify({ allowIncoming: input.allowIncoming })
      });
      pushData({ chatDeclaration: data.allowIncoming });
      setStatus("settings", "success", `Direct messages set to ${data.allowIncoming}`);
    } catch (error) {
      setStatus("settings", "error", describeFailure(error));
    }
    return;
  }

  if (name === "followUser" && typeof input?.actor === "string" && typeof input?.follow === "boolean") {
    setStatus("graph", "busy", input.follow ? "Following user…" : "Unfollowing user…");
    try {
      await apiJson("/api/graph/follow", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ actor: input.actor, follow: input.follow })
      });
      setStatus("graph", "success", input.follow ? "Followed user" : "Unfollowed user");
      const profile = await apiJson<Record<string, unknown>>(`/api/profile/${encodeURIComponent(input.actor)}`);
      pushData({ profile: JSON.stringify(profile) });
    } catch (error) {
      setStatus("graph", "error", describeFailure(error));
    }
    return;
  }

  if (name === "muteUser" && typeof input?.actor === "string" && typeof input?.mute === "boolean") {
    setStatus("graph", "busy", input.mute ? "Muting user…" : "Unmuting user…");
    try {
      await apiJson("/api/graph/mute", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ actor: input.actor, mute: input.mute })
      });
      setStatus("graph", "success", input.mute ? "User muted" : "User unmuted");
      const profile = await apiJson<Record<string, unknown>>(`/api/profile/${encodeURIComponent(input.actor)}`);
      pushData({ profile: JSON.stringify(profile) });
    } catch (error) {
      setStatus("graph", "error", describeFailure(error));
    }
    return;
  }

  if (name === "blockUser" && typeof input?.actor === "string" && typeof input?.block === "boolean") {
    setStatus("graph", "busy", input.block ? "Blocking user…" : "Unblocking user…");
    try {
      await apiJson("/api/graph/block", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ actor: input.actor, block: input.block })
      });
      setStatus("graph", "success", input.block ? "User blocked" : "User unblocked");
      const profile = await apiJson<Record<string, unknown>>(`/api/profile/${encodeURIComponent(input.actor)}`);
      pushData({ profile: JSON.stringify(profile) });
    } catch (error) {
      setStatus("graph", "error", describeFailure(error));
    }
    return;
  }

  if (name === "uploadAvatar") {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/jpeg,image/png,image/webp";
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      setStatus("profile", "busy", "Uploading avatar…");
      try {
        const resp = await fetch("/api/profile/avatar", {
          method: "POST",
          headers: { ...mutationHeaders(), "Content-Type": file.type },
          body: file
        });
        if (!resp.ok) throw new Error(await resp.text());
        setStatus("profile", "success", "Avatar updated");
        const actor = location.pathname.startsWith("/profile/")
          ? decodeURIComponent(location.pathname.slice("/profile/".length))
          : undefined;
        if (actor) {
          const profile = await apiJson<Record<string, unknown>>(`/api/profile/${encodeURIComponent(actor)}`);
          pushData({ profile: JSON.stringify(profile) });
        }
      } catch (error) {
        setStatus("profile", "error", describeFailure(error));
      }
    };
    fileInput.click();
    return;
  }

  if (name === "updateProfile" && typeof input?.inputJson === "string") {
    setStatus("profile", "busy", "Saving profile…");
    try {
      const payload = JSON.parse(input.inputJson) as Record<string, unknown>;
      await apiJson("/api/profile", {
        method: "PUT",
        headers: mutationHeaders(),
        body: JSON.stringify(payload)
      });
      setStatus("profile", "success", "Profile updated");
      const session = await getSession();
      if (session.did) {
        const profile = await apiJson<Record<string, unknown>>(`/api/profile/${encodeURIComponent(session.did)}`);
        pushData({ profile: JSON.stringify(profile) });
      }
    } catch (error) {
      setStatus("profile", "error", describeFailure(error));
    }
    return;
  }

  if (name === "reactToPost" && typeof input?.uri === "string" && typeof input?.cid === "string" && typeof input?.action === "string") {
    try {
      await apiJson("/api/reactions", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ uri: input.uri, cid: input.cid, action: input.action })
      });
      setStatus("post", "success", `Post ${input.action} updated`);
    } catch (error) {
      setStatus("post", "error", describeFailure(error));
    }
    return;
  }

  if (name === "loadThread" && typeof input?.uri === "string") {
    try {
      const thread = await apiJson<Record<string, unknown>>(`/api/post-thread?uri=${encodeURIComponent(input.uri)}`);
      pushData({ thread: JSON.stringify(thread) });
    } catch (error) {
      setStatus("post", "error", describeFailure(error));
    }
    return;
  }

  if (name === "setDmAgentEnabled" && typeof input?.enabled === "boolean") {
    setStatus("settings", "busy", "Updating settings…");
    try {
      await apiJson("/api/settings/dm-agent", {
        method: "PUT",
        headers: mutationHeaders(),
        body: JSON.stringify({ enabled: input.enabled })
      });
      invalidateSessionCache();
      setStatus("settings", "success", "DM Agent settings updated");
      const session = await getSession();
      pushData({ ...session });
    } catch (error) {
      setStatus("settings", "error", describeFailure(error));
    }
    return;
  }

  if (name === "saveHomeSettings" && typeof input?.mode === "string") {
    setStatus("settings", "busy", "Updating home mode…");
    try {
      await apiJson("/api/home/settings", {
        method: "PUT",
        headers: mutationHeaders(),
        body: JSON.stringify({
          mode: input.mode,
          activeHomePath: typeof input.activeHomePath === "string" ? input.activeHomePath : null
        })
      });
      setStatus("settings", "success", "Home mode settings updated");
      const settings = await apiJson<Record<string, unknown>>("/api/home/settings");
      pushData({ homeSettings: JSON.stringify(settings) });
    } catch (error) {
      setStatus("settings", "error", describeFailure(error));
    }
    return;
  }

  if (name === "markNotificationsSeen") {
    try {
      await apiJson("/api/notifications/seen", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({})
      });
      const page = await apiJson<{ notifications: unknown[]; cursor?: string }>("/api/notifications?limit=25");
      pushData({ notifications: JSON.stringify(page) });
    } catch {
      // Non-blocking
    }
    return;
  }
}
