import { Agent } from "@atproto/api";
import type { CloudflareEnv } from "../../types.js";

export interface VideoSpikeStep {
  method: string;
  status: number;
  outcome: "ok" | "denied" | "unavailable" | "error";
  note?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

function step(method: string, status: number, extra?: Pick<VideoSpikeStep, "note" | "data">): VideoSpikeStep {
  return {
    method,
    status,
    outcome: status === 401 || status === 403 ? "denied" : status === 0 ? "unavailable" : status < 400 ? "ok" : "error",
    note: extra?.note,
    data: extra?.data
  };
}

function errorStep(method: string, error: unknown): VideoSpikeStep {
  const status = (error as { status?: number }).status ?? 0;
  const note = String((error as { message?: string }).message ?? error).slice(0, 200);
  return step(method, status, { note });
}

/**
 * Phase A4 acceptance spike, stage 1 (Worker): service-auth for the video
 * service and a startUpload allocation. The returned service token and job
 * metadata let the browser stream the MP4 directly to video.bsky.app
 * (uploadPart/finishUpload/status) without the Worker ever holding video
 * bytes. Temporary probe code — removed before Phase 2 ships.
 */
export async function probeVideoStart(
  oauthSession: unknown,
  getSessionServiceAuth: (aud: string, lxm: string) => Promise<string>,
  serviceAudience: string,
  pdsDid: string,
  sizeBytes: number
): Promise<{ steps: VideoSpikeStep[]; token: string | null; jobId: string | null; partSizeBytes: number | null; partCount: number | null }> {
  const steps: VideoSpikeStep[] = [];
  const timeout = (): AbortSignal => AbortSignal.timeout(20_000) as never;
  let token: string | null = null;
  let jobId: string | null = null;
  let partSizeBytes: number | null = null;
  let partCount: number | null = null;

  // 1. Live upload limits. The video service requires a service-auth token
  // minted per lexicon method (aud=video service, lxm=the called method).
  let limitsOk = false;
  try {
    const limitsToken = await getSessionServiceAuth(serviceAudience, "app.bsky.video.getUploadLimits");
    steps.push(step("getServiceAuth(aud=service, lxm=getUploadLimits)", 200, { data: { serviceAudience } }));
    const limits = await fetch("https://video.bsky.app/xrpc/app.bsky.video.getUploadLimits", {
      headers: { Authorization: `Bearer ${limitsToken}` },
      signal: timeout()
    });
    const body = await limits.json().catch(() => ({})) as {
      canUpload?: boolean;
      remainingDailyVideos?: number;
      remainingDailyBytes?: number;
      message?: string;
      error?: string;
    };
    // Strict: only an explicit true from a 200 response is upload-capable;
    // malformed/empty JSON fails closed.
    limitsOk = limits.ok && body.canUpload === true;
    steps.push(step("app.bsky.video.getUploadLimits", limitsOk ? limits.status : 417, {
      data: {
        canUpload: body.canUpload,
        remainingDailyVideos: body.remainingDailyVideos,
        remainingDailyBytes: body.remainingDailyBytes,
        message: body.message ?? body.error
      }
    }));
  } catch (error) {
    steps.push(errorStep("app.bsky.video.getUploadLimits", error));
  }
  if (!limitsOk) {
    // Empirical capability split: bsky.social does not include the video
    // rpc scopes in its issued grant (it drops them silently), so accounts
    // hosted there cannot mint the getUploadLimits token — the PDS denies
    // the mint with a scope error. Upload capability is still provable via
    // the uploadBlob-lxm service-auth path (which those grants do include),
    // so record limits as unavailable and proceed; the product limit is
    // enforced by Netslum itself when live limits are unknown.
    steps.push({
      method: "app.bsky.video.getUploadLimits",
      status: 0,
      outcome: "unavailable",
      note: "limits unavailable for this authorization server; proceeding under the Netslum product limit"
    });
  }

  // 2. startUpload allocation — its own per-method token; this token is
  // also what the browser uses for uploadPart/finishUpload/getJobStatus.
  try {
    // Empirical token matrix (A4): getUploadLimits wants aud=video service
    // with its own lxm; startUpload and the whole upload session accept the
    // PDS-audience uploadBlob-lxm token that every Phase-2 grant includes.
    // Mint the startUpload-lxm token first when the grant carries video
    // scopes, otherwise fall straight through to the uploadBlob token.
    let startUploadTokenMinted = false;
    try {
      token = await getSessionServiceAuth(serviceAudience, "app.bsky.video.startUpload");
      startUploadTokenMinted = true;
      steps.push(step("getServiceAuth(aud=service, lxm=startUpload)", 200));
    } catch (mintError) {
      steps.push(errorStep("getServiceAuth(aud=service, lxm=startUpload)", mintError));
    }
    if (!startUploadTokenMinted) {
      if (!pdsDid) {
        steps.push(step("app.bsky.video.startUpload", 0, { note: "no PDS DID available for the PDS-audience token" }));
        return { steps, token: null, jobId: null, partSizeBytes: null, partCount: null };
      }
      token = await getSessionServiceAuth(pdsDid, "com.atproto.repo.uploadBlob");
      steps.push(step("getServiceAuth(aud=pds, lxm=uploadBlob)", 200, { data: { pdsDid } }));
    }
    let start = await fetch("https://video.bsky.app/xrpc/app.bsky.video.startUpload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sizeBytes, mimeType: "video/mp4", name: "netslum-spike.mp4" }),
      signal: timeout()
    });
    if (start.status === 401 && pdsDid) {
      // Some authorizations mint a startUpload-lxm token the video service
      // still rejects; retry once with the PDS-audience uploadBlob token.
      token = await getSessionServiceAuth(pdsDid, "com.atproto.repo.uploadBlob");
      steps.push(step("getServiceAuth(aud=pds, lxm=uploadBlob)", 200, { data: { pdsDid }, note: "retry after 401" }));
      start = await fetch("https://video.bsky.app/xrpc/app.bsky.video.startUpload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sizeBytes, mimeType: "video/mp4", name: "netslum-spike.mp4" }),
        signal: timeout()
      });
    }
    const body = await start.json().catch(() => ({})) as { jobId?: string; partSizeBytes?: number; partCount?: number; message?: string };
    jobId = body.jobId ?? null;
    partSizeBytes = body.partSizeBytes ?? null;
    partCount = body.partCount ?? null;
    steps.push(step("app.bsky.video.startUpload", start.ok ? start.status : 0, {
      data: { jobId, partSizeBytes, partCount },
      note: body.message?.slice(0, 160)
    }));
  } catch (error) {
    steps.push(errorStep("app.bsky.video.startUpload", error));
  }

  return { steps, token, jobId, partSizeBytes, partCount };
}

/**
 * Phase A4 acceptance spike, stage 2 (Worker): publish an app.bsky.embed.video
 * post with the completed blob ref, hydrate it through the AppView proxy,
 * then delete the spike post. The browser performed uploadPart/finish/status
 * directly against the video service with the stage-1 token. Temporary
 * probe code — removed before Phase 2 ships.
 */
export async function probeVideoPublish(
  env: CloudflareEnv,
  oauthSession: unknown,
  actorDid: string,
  blobRef: Record<string, unknown>
): Promise<VideoSpikeStep[]> {
  const steps: VideoSpikeStep[] = [];
  const agent = new Agent(oauthSession as never);
  const timeout = (): AbortSignal => AbortSignal.timeout(20_000) as never;
  void env;

  // 1. Publish the embed-video post (PDS-assigned rkey).
  let postUri: string | null = null;
  try {
    const publish = await agent.com.atproto.repo.createRecord({
      repo: actorDid,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: "netslum phase 2 video spike",
        createdAt: new Date().toISOString(),
        embed: { $type: "app.bsky.embed.video", video: blobRef, alt: "netslum spike video" }
      }
    }, { signal: timeout() });
    postUri = publish.data.uri;
    steps.push(step("createRecord(app.bsky.feed.post+embed.video)", 200, { data: { postUri } }));
  } catch (error) {
    steps.push(errorStep("createRecord(app.bsky.feed.post+embed.video)", error));
    return steps;
  }

  // 2. Hydrate through the AppView proxy.
  if (postUri) {
    const appview = new Agent(oauthSession as never);
    appview.configureProxy("did:web:api.bsky.app#bsky_appview");
    const blobLink = (blobRef.ref as { $link?: unknown } | undefined)?.$link;
    const blobCid = typeof blobLink === "string" && blobLink.length > 0 ? blobLink : null;
    let hydrated = false;
    let uriMatches = false;
    let cidMatches: boolean | null = null;
    let terminalError: unknown = null;
    // AppView indexing is eventual: poll boundedly until the exact URI,
    // video embed view type, and blob CID all match the created record.
    for (let attempt = 0; attempt < 10 && !hydrated; attempt += 1) {
      try {
        const thread = await appview.app.bsky.feed.getPostThread({ uri: postUri, depth: 0 }, { signal: timeout() });
        const threadPost = thread.data.thread;
        const embed = threadPost && "post" in threadPost ? threadPost.post.embed : undefined;
        const videoEmbed = embed && embed.$type === "app.bsky.embed.video#view" ? embed as { $type: string; cid?: string } : null;
        uriMatches = Boolean(threadPost && "post" in threadPost && threadPost.post.uri === postUri);
        cidMatches = videoEmbed && blobCid ? videoEmbed.cid === blobCid : null;
        hydrated = Boolean(blobCid && uriMatches && videoEmbed && videoEmbed.cid === blobCid);
        if (!hydrated && attempt < 9) await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        // NotFound while indexing settles is expected; anything else is terminal.
        const status = (error as { status?: number }).status ?? 0;
        if (status !== 400 && status !== 404) {
          terminalError = error;
          break;
        }
        if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (terminalError !== null) {
      steps.push(errorStep("getPostThread(hydrate)", terminalError));
    } else {
      steps.push(step("getPostThread(hydrate)", hydrated ? 200 : 417, {
        data: { hydrated, uriMatches, cidMatches }
      }));
    }

    // 3. Delete the spike post.
    const rkey = postUri.split("/").pop() ?? "";
    try {
      await agent.com.atproto.repo.deleteRecord({ repo: actorDid, collection: "app.bsky.feed.post", rkey }, { signal: timeout() });
      steps.push(step("deleteRecord(app.bsky.feed.post)", 200, { data: { rkey } }));
    } catch (error) {
      steps.push(errorStep("deleteRecord(app.bsky.feed.post)", error));
    }
  }

  return steps;
}
