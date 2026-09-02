import { Agent } from "@atproto/api";

export interface CapabilityResult {
  method: string;
  audience: "appview" | "chat";
  status: number;
  outcome: "ok" | "unavailable" | "denied" | "error";
  note?: string | undefined;
}

const APPVIEW_PROXY = "did:web:api.bsky.app#bsky_appview";
const CHAT_PROXY = "did:web:api.bsky.chat#bsky_chat";

const abort = (): AbortSignal => AbortSignal.timeout(8000);

function classify(method: string, audience: CapabilityResult["audience"], error: unknown): CapabilityResult {
  const err = error as { status?: number; message?: string };
  const status = typeof err.status === "number" ? err.status : 0;
  const note = String(err.message ?? "").slice(0, 200);
  const outcome: CapabilityResult["outcome"] = status === 401 || status === 403 ? "denied" : status === 0 ? "unavailable" : "error";
  return { method, audience, status, outcome, note: note || undefined };
}

function ok(method: string, audience: CapabilityResult["audience"]): CapabilityResult {
  return { method, audience, status: 200, outcome: "ok" };
}

export async function probeAppviewCapabilities(oauthSession: unknown): Promise<CapabilityResult[]> {
  const appviewAgent = new Agent(oauthSession as never);
  appviewAgent.configureProxy(APPVIEW_PROXY);
  const chatAgent = new Agent(oauthSession as never);
  chatAgent.configureProxy(CHAT_PROXY);

  const checks: Array<Promise<CapabilityResult>> = [
    appviewAgent.app.bsky.feed.getTimeline({ limit: 3 }, { signal: abort() })
      .then(() => ok("app.bsky.feed.getTimeline", "appview"), (error) => classify("app.bsky.feed.getTimeline", "appview", error)),
    appviewAgent.app.bsky.actor.getProfile({ actor: (oauthSession as { did: string }).did }, { signal: abort() })
      .then(() => ok("app.bsky.actor.getProfile", "appview"), (error) => classify("app.bsky.actor.getProfile", "appview", error)),
    appviewAgent.app.bsky.actor.getPreferences({})
      .then(() => ok("app.bsky.actor.getPreferences", "appview"), (error) => classify("app.bsky.actor.getPreferences", "appview", error)),
    appviewAgent.app.bsky.feed.searchPostsV2({ query: "netslum", limit: 3 }, { signal: abort() })
      .then(() => ok("app.bsky.feed.searchPostsV2", "appview"), (error) => classify("app.bsky.feed.searchPostsV2", "appview", error)),
    appviewAgent.app.bsky.notification.listNotifications({ limit: 3 }, { signal: abort() })
      .then(() => ok("app.bsky.notification.listNotifications", "appview"), (error) => classify("app.bsky.notification.listNotifications", "appview", error)),
    appviewAgent.app.bsky.graph.getFollows({ actor: (oauthSession as { did: string }).did, limit: 3 }, { signal: abort() })
      .then(() => ok("app.bsky.graph.getFollows", "appview"), (error) => classify("app.bsky.graph.getFollows", "appview", error)),
    chatAgent.chat.bsky.convo.listConvos({ limit: 3 }, { signal: abort() })
      .then(() => ok("chat.bsky.convo.listConvos", "chat"), (error) => classify("chat.bsky.convo.listConvos", "chat", error)),
    chatAgent.chat.bsky.actor.getStatus({})
      .then(() => ok("chat.bsky.actor.getStatus", "chat"), (error) => classify("chat.bsky.actor.getStatus", "chat", error))
  ];

  const settled = await Promise.allSettled(checks);
  return settled.map((entry) =>
    entry.status === "fulfilled" ? entry.value : classify("probe", "appview", entry.reason)
  );
}

