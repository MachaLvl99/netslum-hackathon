import type { StudioSite } from "./types.js";
import type { SessionInfo } from "../webmcp.js";
import { state, pushData } from "./state.js";
import { apiJson, describeFailure, getSession, loadTimelinePage, mutationHeaders, setStatus } from "./api.js";
import { clearZoneScene, zoneKeyForPath } from "./zoneCanvas.js";
import { refreshZone, startLiveUpdates } from "./liveUpdates.js";
import { resolveAuthoredHome, resolveDistrictMount, resolveStudioMount } from "./mounts.js";
import { registerNetslumTools } from "../webmcp.js";

export async function markConvoRead(convoId: string): Promise<void> {
  try {
    await apiJson("/api/dms/read", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ convoId })
    });
    const cleared = state.currentConversations.map((entry) =>
      entry.convoId === convoId ? { ...entry, unreadCount: 0 } : entry
    );
    state.currentConversations = cleared;
    pushData({ conversations: JSON.stringify({ convos: cleared }) });
  } catch (error) {
    setStatus("message", "error", `Could not mark read: ${describeFailure(error)}`);
  }
}

export async function loadRouteData(pathname: string, session: SessionInfo, generation: number): Promise<void> {
  try {
    if ((pathname === "/" || pathname === "/studio" || pathname === "/dashboard") && session.authenticated) {
      try {
        const layoutRes = await apiJson<{ schema: unknown }>("/api/home/schema").catch(() => null);
        if (generation === state.routeGeneration && layoutRes?.schema) {
          pushData({ homeLayout: JSON.stringify(layoutRes.schema) });
        } else if (generation === state.routeGeneration) {
          pushData({ homeLayout: "" });
        }
      } catch {
        // Non-blocking
      }
    }
    if (pathname === "/timeline" && session.authenticated) {
      const posts = await loadTimelinePage();
      if (generation === state.routeGeneration) pushData({ timeline: JSON.stringify({ posts: posts ?? [] }), routeError: "" });
      return;
    }
    if (pathname === "/notifications" && session.authenticated) {
      const page = await apiJson<{ notifications: unknown[]; cursor?: string }>("/api/notifications?limit=25");
      if (generation === state.routeGeneration) pushData({ notifications: JSON.stringify(page), routeError: "" });
      return;
    }
    if (pathname === "/settings" && session.authenticated) {
      try {
        const [settings, decl] = await Promise.all([
          apiJson<Record<string, unknown>>("/api/home/settings").catch(() => null),
          apiJson<{ allowIncoming: string | null }>("/api/settings/chat-declaration").catch(() => null)
        ]);
        if (generation === state.routeGeneration) {
          pushData({
            ...(settings ? { homeSettings: JSON.stringify(settings) } : {}),
            chatDeclaration: decl?.allowIncoming ?? "following",
            routeError: ""
          });
        }
      } catch {
        // External accounts do not have home settings
      }
      return;
    }
    if (pathname.startsWith("/post/")) {
      const uri = decodeURIComponent(pathname.slice("/post/".length));
      const thread = await apiJson<Record<string, unknown>>(`/api/post-thread?uri=${encodeURIComponent(uri)}`);
      if (generation === state.routeGeneration) pushData({ thread: JSON.stringify(thread), routeError: "" });
      return;
    }
    if (
      (pathname === "/messages" || pathname === "/messages/requests" || pathname.startsWith("/messages/")) &&
      session.authenticated
    ) {
      const isRequests = pathname.endsWith("/requests");
      const endpoint = isRequests ? "/api/dms/requests?limit=25" : "/api/dms/conversations?limit=25";
      const raw = await apiJson<{
        convos?: Array<Record<string, unknown>>;
        requests?: Array<Record<string, unknown>>;
        cursor?: string;
      }>(endpoint);
      const source = raw.convos ?? raw.requests ?? [];
      const freshRecipients = new Map<string, string[]>();
      const convos = source.flatMap((entry) => {
        const id = typeof entry.id === "string" ? entry.id : null;
        if (!id) return [];
        const members = Array.isArray(entry.members) ? (entry.members as Array<{ did?: string; handle?: string }>) : [];
        const recipientDids = members.flatMap((member) => {
          const did = member.did;
          return typeof did === "string" && did !== session.did ? [did] : [];
        });
        freshRecipients.set(id, recipientDids);
        const other = members.find((member) => typeof member.did === "string" && member.did !== session.did);
        const lastMessage =
          typeof entry.lastMessage === "object" && entry.lastMessage !== null
            ? (entry.lastMessage as { text?: string })
            : null;
        return [
          {
            convoId: id,
            unreadCount: typeof entry.unreadCount === "number" ? entry.unreadCount : 0,
            muted: entry.muted === true,
            status: isRequests ? "request" : "accepted",
            ...(typeof lastMessage?.text === "string" ? { lastMessageText: lastMessage.text } : {}),
            ...(typeof other?.handle === "string" ? { otherHandle: other.handle } : {})
          }
        ];
      });

      // Merge: keep entries from prior map that API list doesn't contain yet
      for (const [k, v] of state.conversationRecipients) {
        if (!freshRecipients.has(k)) freshRecipients.set(k, v);
      }
      state.conversationRecipients = freshRecipients;
      state.currentConversations = convos;
      if (generation === state.routeGeneration) {
        pushData({ conversations: JSON.stringify({ convos, cursor: raw.cursor }), routeError: "" });
      }

      if (pathname.startsWith("/messages/") && !isRequests) {
        const convoId = pathname.slice("/messages/".length);
        if (convoId) {
          const data = await apiJson<{ messages: Array<Record<string, unknown>> }>(
            `/api/dms/messages?convoId=${encodeURIComponent(convoId)}`
          );
          const rawMessages = data.messages as Array<{ id?: string; text?: string; sender?: { did?: string }; reactions?: unknown[]; sentAt?: string }>;
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
          if (generation === state.routeGeneration) {
            pushData({ messages: JSON.stringify({ messages }) });
          }
          void markConvoRead(convoId);
        }
      }
    }
  } catch (error) {
    if (generation === state.routeGeneration) {
      pushData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
    }
  }
}

export async function syncRoute(): Promise<void> {
  const generation = ++state.routeGeneration;
  const pathname = location.pathname;
  let session: SessionInfo = { authenticated: false };
  try {
    session = await getSession();
  } catch (error) {
    pushData({ routeError: describeFailure(error) });
  }
  if (generation !== state.routeGeneration) return;

  state.currentToolAbort?.abort();
  state.currentToolAbort = new AbortController();
  registerNetslumTools(navigate, session, state.currentToolAbort.signal);
  pushData({
    route: pathname + location.search,
    ...session,
    routeError: "",
    composeRecipient: pathname === "/messages" ? new URLSearchParams(location.search).get("compose") ?? "" : ""
  });

  // Header avatar: fetch profile picture once per sign-in.
  if (session.authenticated && session.did) {
    if (state.headerAvatarCache.did === session.did) {
      if (generation === state.routeGeneration) pushData({ headerAvatar: state.headerAvatarCache.url });
    } else {
      const did = session.did;
      void apiJson<{ avatar?: string }>(`/api/profile/${encodeURIComponent(did)}`)
        .then((profile) => {
          state.headerAvatarCache = { did, url: profile.avatar ?? "" };
          if (state.routeGeneration === generation) pushData({ headerAvatar: profile.avatar ?? "" });
        })
        .catch(() => undefined);
    }
  }

  const zoneKey = zoneKeyForPath(pathname);
  if (zoneKey) await refreshZone(zoneKey);
  else clearZoneScene();

  await Promise.all([
    resolveAuthoredHome(state.currentToolAbort.signal),
    resolveDistrictMount(state.currentToolAbort.signal),
    resolveStudioMount(),
    loadRouteData(pathname, session, generation)
  ]);

  if (pathname.startsWith("/profile/") || (pathname.startsWith("/@") && !pathname.startsWith("/@netslum"))) {
    const actor = decodeURIComponent(
      pathname.startsWith("/profile/") ? pathname.slice("/profile/".length) : pathname.slice(1)
    );
    try {
      const [profile, authorFeed, publicSchema] = await Promise.all([
        apiJson<{ did: string; handle: string; displayName?: string; description?: string; siteUrl?: string | null }>(
          `/api/profile/${encodeURIComponent(actor)}`
        ),
        apiJson<{ posts: unknown[] }>(`/api/author-feed?actor=${encodeURIComponent(actor)}&limit=25`).catch(() => ({ posts: [] })),
        apiJson<{ schema: unknown }>(`/api/sites/public-schema?slug=${encodeURIComponent(actor)}`).catch(() => ({ schema: null }))
      ]);
      pushData({
        profile: JSON.stringify(profile),
        authorPosts: JSON.stringify(authorFeed.posts ?? []),
        publicPageSchema: publicSchema?.schema ? JSON.stringify(publicSchema.schema) : "",
        routeError: "",
        lastUpdatedAt: Date.now()
      });
    } catch (error) {
      pushData({ profile: "", authorPosts: "[]", routeError: describeFailure(error), lastUpdatedAt: Date.now() });
    }
  }

  if (pathname === "/studio" && session.authenticated) {
    try {
      const site = await apiJson<StudioSite>(`/api/sites/draft`);
      pushData({ site: JSON.stringify(site), routeError: "", lastUpdatedAt: Date.now() });
    } catch (error) {
      pushData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
    }
  }

  if (generation === state.routeGeneration) {
    startLiveUpdates(pathname);
    // Robustness (session persistence): re-push fresh session snapshot as the
    // final step. Data only flows after the appReady handshake.
    pushData({ route: pathname + location.search, ...session });
  }
}

export function navigate(route: string): void {
  if (!route.startsWith("/")) return;
  if (route === "/oauth/login") {
    location.assign(route);
    return;
  }
  const target = new URL(route, location.origin);
  if (target.pathname !== location.pathname || target.search !== location.search) {
    history.pushState({}, "", route);
  }
  void syncRoute();
}
