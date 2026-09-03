import type { ActionSheetParams, StudioSite } from "./types.js";
import { state } from "./state.js";
import { apiJson, mutationHeaders, setStatus, getSession } from "./api.js";

/**
 * Tenant tool manifests (plan §F2): registers tools as site.<slug>.<name>.
 */
export async function registerTenantTools(slug: string, signal: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || typeof document.modelContext?.registerTool !== "function") return;
  let manifest: { tools: Array<{ name: string; title?: string; description: string; inputSchema: object }> } | null = null;
  try {
    const response = await fetch(`/api/sites/manifest?slug=${encodeURIComponent(slug)}`, { signal });
    if (response.ok) {
      const body = (await response.json()) as {
        manifest: { tools: Array<{ name: string; title?: string; description: string; inputSchema: object }> } | null;
      };
      manifest = body.manifest;
    } else {
      return;
    }
  } catch {
    return;
  }
  if (!manifest || !Array.isArray(manifest.tools)) return;
  for (const tool of manifest.tools.slice(0, 8)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(tool.name)) continue;
    try {
      await document.modelContext.registerTool(
        {
          name: `site.${slug}.${tool.name}`,
          title: tool.title ?? tool.name,
          description: tool.description.slice(0, 500),
          inputSchema: tool.inputSchema,
          annotations: { untrustedContentHint: true },
          execute: async (input: unknown): Promise<unknown> => {
            const response = await fetch(`/api/__webmcp/${slug}/${encodeURIComponent(tool.name)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ input }),
              signal: AbortSignal.timeout(10_000)
            });
            const body: unknown = await response.json().catch(() => ({}));
            if (!response.ok) throw body;
            const iframe =
              (document.getElementById("authored-home-mount") as HTMLIFrameElement) ??
              (document.getElementById("district-mount") as HTMLIFrameElement);
            if (iframe?.contentWindow && state.activeTenantOrigin) {
              iframe.contentWindow.postMessage(
                { type: "netslum:tenantToolResult", tool: tool.name, result: body },
                state.activeTenantOrigin
              );
            }
            return body;
          }
        },
        { signal }
      );
      state.tenantTools.push({ name: `site.${slug}.${tool.name}` });
    } catch {
      // Ignore invalid tool schema
    }
  }
}

/**
 * Authored home (plan §E2): mounts home.html from tenant origin.
 */
export async function resolveAuthoredHome(signal: AbortSignal): Promise<void> {
  document.getElementById("authored-home-mount")?.remove();
  state.activeTenantOrigin = null;
  state.tenantTools = [];
  if (location.pathname !== "/") return;
  try {
    const mount = await apiJson<{ mode: string; tenantOrigin?: string; path?: string; title?: string }>("/api/home/mount");
    if (mount.mode !== "authored" || !mount.tenantOrigin || !mount.path) return;
    const iframe = document.createElement("iframe");
    iframe.id = "authored-home-mount";
    iframe.title = mount.title ?? "authored home";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.setAttribute("allow", "webgpu; tools");
    iframe.src = `${mount.tenantOrigin}${mount.path}`;
    iframe.style.cssText = "position:fixed;inset:52px 0 0 0;width:100vw;height:calc(100vh - 52px);border:none;background:#070910;z-index:5;";
    document.body.appendChild(iframe);
    state.activeTenantOrigin = mount.tenantOrigin;
    const slug = new URL(mount.tenantOrigin).hostname.split(".")[0];
    if (slug) await registerTenantTools(slug, signal);
  } catch {
    // Fall back to standard home
  }
}

/**
 * District view mounting (plan §E4): mounts district iframe with WebGPU delegation.
 */
export async function resolveDistrictMount(signal: AbortSignal): Promise<void> {
  document.getElementById("district-mount")?.remove();
  state.activeTenantOrigin = null;
  if (!location.pathname.startsWith("/district/")) return;
  const slug = location.pathname.slice("/district/".length).split("?")[0] ?? "";
  if (!slug) return;
  const searchParams = new URLSearchParams(location.search);
  const path = searchParams.get("path") || "index.html";

  const iframe = document.createElement("iframe");
  iframe.id = "district-mount";
  iframe.title = `district @${slug}`;
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.setAttribute("allow", "webgpu; tools");
  iframe.src = `https://${slug}.sites.netslum.macha.sh/${path}`;
  iframe.style.cssText = "position:fixed;inset:52px 0 0 0;width:100vw;height:calc(100vh - 52px);border:none;background:#070910;z-index:5;";
  document.body.appendChild(iframe);
  state.activeTenantOrigin = `https://${slug}.sites.netslum.macha.sh`;
  await registerTenantTools(slug, signal);
}

/**
 * Studio mount (Phase 3): Studio renders ONLY what the agent built.
 */
export async function resolveStudioMount(): Promise<void> {
  document.getElementById("studio-mount")?.remove();
  if (location.pathname !== "/studio") return;
  const session = await getSession().catch(() => null);
  if (!session?.authenticated) return;
  try {
    const draft = await apiJson<StudioSite>("/api/sites/draft");
    const hasBuiltDraft = draft.files.length > 0 && !draft.isStarter;
    const draftChanged = hasBuiltDraft && draft.revision !== draft.activeRevision;
    let mountUrl: string | null = null;
    if (draftChanged || (!draft.activeRevision && hasBuiltDraft)) {
      const preview = await apiJson<{ previewUrl: string }>("/api/sites/preview-session", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ revision: draft.revision })
      });
      mountUrl = preview.previewUrl;
    } else if (draft.activeRevision) {
      mountUrl = `https://${draft.slug}.sites.netslum.macha.sh/`;
    }
    if (!mountUrl) return; // Nothing built yet — StudioView shows empty phrase.
    const iframe = document.createElement("iframe");
    iframe.id = "studio-mount";
    iframe.title = "your page";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.src = mountUrl;
    iframe.style.cssText = "position:fixed;inset:56px 0 0 0;width:100vw;height:calc(100vh - 56px);border:none;background:#0d0d0d;z-index:5;";
    document.body.appendChild(iframe);
  } catch {
    // Render errors fall through: StudioView shows the empty state.
  }
}

/**
 * Trusted Action Sheet (plan §E2)
 */
export function showActionSheet(params: ActionSheetParams): void {
  document.getElementById("action-sheet-mount")?.remove();

  const mount = document.createElement("div");
  mount.id = "action-sheet-mount";
  mount.style.cssText =
    "position:fixed;inset:0;background:rgba(7,9,16,0.8);backdrop-filter:blur(6px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#101522;border:1px solid #57E6FF;border-radius:8px;padding:24px;max-width:480px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.8);font-family:ui-monospace,Menlo,Consolas,monospace;color:#E8F0FF;";

  let title = "CONFIRM ACTION";
  let description = "";

  if (params.kind === "like-post") {
    title = "CONFIRM LIKE";
    description = `The site at ${params.origin} requested to like a post:\n${params.subjectUri ?? ""}`;
  } else if (params.kind === "toggle-follow") {
    title = "CONFIRM FOLLOW ACTION";
    description = `The site at ${params.origin} requested to follow user @${params.actorInput ?? ""}.`;
  } else if (params.kind === "reply-to-post") {
    title = "CONFIRM REPLY";
    description = `The site at ${params.origin} requested to post a reply:\n"${params.text ?? ""}"\nto post ${params.subjectUri ?? ""}`;
  }

  card.innerHTML = `
    <div style="color:#57E6FF;font-size:11px;letter-spacing:2px;font-weight:700;margin-bottom:8px;">TRUSTED ACTION SHEET</div>
    <div style="color:#E8F0FF;font-size:18px;font-weight:700;margin-bottom:12px;">${title}</div>
    <div style="color:#8792AA;font-size:13px;line-height:1.5;margin-bottom:24px;word-break:break-all;white-space:pre-wrap;">${description}</div>
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button id="action-sheet-cancel" style="background:#171D2E;border:1px solid #2A3652;color:#8792AA;padding:10px 18px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">CANCEL</button>
      <button id="action-sheet-confirm" style="background:#57E6FF;border:1px solid #57E6FF;color:#071016;padding:10px 18px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">CONFIRM</button>
    </div>
  `;

  mount.appendChild(card);
  document.body.appendChild(mount);

  const close = () => mount.remove();
  card.querySelector("#action-sheet-cancel")?.addEventListener("click", close);
  card.querySelector("#action-sheet-confirm")?.addEventListener("click", () => {
    void (async () => {
      close();
      try {
        if (params.kind === "like-post" && params.subjectUri) {
          await apiJson("/api/reactions", {
            method: "POST",
            headers: mutationHeaders(),
            body: JSON.stringify({ uri: params.subjectUri, cid: params.subjectCid ?? "", action: "like" })
          });
          setStatus("post", "success", "Post liked");
        } else if (params.kind === "toggle-follow" && params.actorInput) {
          await apiJson("/api/graph/follow", {
            method: "POST",
            headers: mutationHeaders(),
            body: JSON.stringify({ actor: params.actorInput, follow: true })
          });
          setStatus("post", "success", `Followed ${params.actorInput}`);
        } else if (params.kind === "reply-to-post" && params.subjectUri && params.text) {
          const draft = await apiJson<{ draftRevision: string }>("/api/post-draft", {
            method: "PUT",
            headers: mutationHeaders(),
            body: JSON.stringify({
              text: params.text,
              expectedRevision: null,
              replyToUri: params.subjectUri,
              ...(params.subjectCid ? { replyToCid: params.subjectCid } : {}),
              destination: "town"
            })
          });
          await apiJson("/api/posts/publish", {
            method: "POST",
            headers: mutationHeaders(),
            body: JSON.stringify({ draftRevision: draft.draftRevision })
          });
          setStatus("post", "success", "Reply published");
        }
      } catch (error) {
        setStatus("post", "error", error instanceof Error ? error.message : String(error));
      }
    })();
  });
}

/**
 * Window postMessage receiver (plan §E2)
 */
export function initTrustedActionReceiver(navigate: (route: string) => void): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object") return;
    if (data.type !== "netslum:trustedAction") return;

    const authoredFrame = document.getElementById("authored-home-mount") as HTMLIFrameElement | null;
    const districtFrame = document.getElementById("district-mount") as HTMLIFrameElement | null;
    const activeFrame = authoredFrame || districtFrame;
    if (!activeFrame || event.source !== activeFrame.contentWindow) return;

    try {
      const frameOrigin = new URL(activeFrame.src).origin;
      if (event.origin !== frameOrigin && event.origin !== location.origin) return;
    } catch {
      return;
    }

    const kind = typeof data.kind === "string" ? data.kind : typeof data.action === "string" ? data.action : "";
    const subjectUri = typeof data.subjectUri === "string" ? data.subjectUri : undefined;
    const subjectCid = typeof data.subjectCid === "string" ? data.subjectCid : undefined;
    const actorInput = typeof data.actorInput === "string" ? data.actorInput : typeof data.actor === "string" ? data.actor : undefined;
    const route = typeof data.route === "string" ? data.route : undefined;
    const text = typeof data.text === "string" ? data.text : undefined;

    if (kind === "open-post") {
      if (route) navigate(route);
      else if (subjectUri) navigate(`/post/${encodeURIComponent(subjectUri)}`);
      return;
    }
    if (kind === "open-profile") {
      if (route) navigate(route);
      else if (actorInput) navigate(`/profile/${encodeURIComponent(actorInput)}`);
      return;
    }
    if (kind === "open-conversation") {
      if (route) navigate(route);
      else if (subjectUri) navigate(`/messages/${encodeURIComponent(subjectUri)}`);
      else navigate("/messages");
      return;
    }

    if (kind === "like-post" || kind === "toggle-follow" || kind === "reply-to-post") {
      showActionSheet({
        kind,
        subjectUri,
        subjectCid,
        actorInput,
        text,
        origin: event.origin
      });
    }
  });
}
