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

export interface VideoProbeResult {
  limits: CapabilityResult & { data?: { canUpload?: boolean | undefined; message?: string | undefined } };
  serviceAuth: CapabilityResult;
  startUpload: CapabilityResult & { data?: { jobId?: string | undefined; partSizeBytes?: number | undefined; partCount?: number | undefined } };
  pdsDid: string | null;
}

export async function probeVideoCapabilities(
  oauthSession: unknown,
  getSessionServiceAuth: (aud: string, lxm: string) => Promise<string>
): Promise<VideoProbeResult> {
  const videoAgent = new Agent(oauthSession as never);
  videoAgent.configureProxy(APPVIEW_PROXY);

  let limits: VideoProbeResult["limits"];
  try {
    const response = await videoAgent.app.bsky.video.getUploadLimits({}, { signal: abort() });
    limits = {
      method: "app.bsky.video.getUploadLimits", audience: "appview", status: 200, outcome: "ok",
      data: { canUpload: response.data.canUpload ?? undefined, message: response.data.message ?? response.data.error ?? undefined }
    };
  } catch (error) {
    limits = { ...classify("app.bsky.video.getUploadLimits", "appview", error), data: {} };
  }

  // The video service identifies itself as did:web:video.bsky.app; the
  // service-auth token audience is the account's own PDS DID per the
  // published upload flow. Resolve the PDS DID from the DID document.
  const did = (oauthSession as { did: string }).did;
  let pdsDid: string | null = null;
  let serviceAuth: CapabilityResult = { method: "getServiceAuth(aud=pds)", audience: "appview", status: 0, outcome: "unavailable" };
  let startUpload: VideoProbeResult["startUpload"] = { method: "app.bsky.video.startUpload", audience: "appview", status: 0, outcome: "unavailable", data: {} };

  try {
    const didDocUrl = did.startsWith("did:plc:")
      ? `https://plc.directory/${encodeURIComponent(did)}`
      : `https://${did.slice(8).split(":")[0]}/.well-known/did.json`;
    const didDoc = (await fetch(didDocUrl, { signal: abort() }).then((r): Promise<{ service?: Array<{ id?: string; serviceEndpoint?: string }> }> => r.json()));
    const pdsEndpoint = didDoc.service?.find((s) => s.id?.endsWith("#atproto_pds"))?.serviceEndpoint;
    pdsDid = pdsEndpoint ? `did:web:${new URL(pdsEndpoint).hostname}` : null;
  } catch {
    pdsDid = null;
  }

  if (pdsDid) {
    try {
      const token = await getSessionServiceAuth(pdsDid, "com.atproto.repo.uploadBlob");
      serviceAuth = { method: "getServiceAuth(aud=pds)", audience: "appview", status: 200, outcome: "ok" };
      const start = await fetch("https://video.bsky.app/xrpc/app.bsky.video.startUpload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sizeBytes: 4096, mimeType: "video/mp4", name: "probe.mp4" }),
        signal: abort()
      });
      const startBody = await start.json().catch(() => ({})) as { jobId?: string; partSizeBytes?: number; partCount?: number; message?: string };
      startUpload = {
        method: "app.bsky.video.startUpload", audience: "appview", status: start.status,
        outcome: start.ok ? "ok" : start.status === 401 || start.status === 403 ? "denied" : "error",
        note: startBody.message?.slice(0, 200), data: start.ok ? startBody : {}
      };
      if (start.ok && startBody.jobId) {
        try {
          const cleanup = await fetch("https://video.bsky.app/xrpc/app.bsky.video.abortUpload", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ jobId: startBody.jobId }),
            signal: abort()
          });
          if (!cleanup.ok) {
            startUpload.note = `${startUpload.note ?? ""} cleanup failed (${cleanup.status})`.trim();
          }
        } catch (cleanupError) {
          startUpload.note = `${startUpload.note ?? ""} cleanup failed: ${String((cleanupError as Error).message).slice(0, 80)}`.trim();
        }
      }
    } catch (error) {
      serviceAuth = { ...classify("getServiceAuth(aud=pds)", "appview", error) };
      startUpload = { ...classify("app.bsky.video.startUpload", "appview", error), data: {} };
    }
  } else {
    serviceAuth = { method: "getServiceAuth(aud=pds)", audience: "appview", status: 0, outcome: "unavailable", note: "PDS DID resolution failed" };
  }

  return { limits, serviceAuth, startUpload, pdsDid };
}
