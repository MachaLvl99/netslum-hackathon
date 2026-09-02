import type { LynxViewElement } from "@lynx-js/web-core/client";
import { renderZoneScene, sceneParamsFromSeed, zoneKeySeed, type SceneObject } from "./scene.js";
import { registerNetslumTools, type SessionInfo } from "./webmcp.js";
interface ApiErrorPayload {
  code?: string;
  message?: string;
  retryable?: boolean;
  data?: { currentRevision?: string; currentVersion?: number };
}

interface ActionStatus {
  action: "post" | "zone" | "site" | "logout";
  state: "busy" | "success" | "error";
  message: string;
  nonce: number;
}

interface ZonePayload {
  zoneKey: string;
  version: number;
  objects: unknown[];
}

interface SiteFileRead {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  revision: string;
  nextOffset?: number;
}

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiErrorPayload
  ) {
    super(payload.message ?? `Request failed with HTTP ${status}`);
  }
}

const host = document.querySelector<HTMLElement>("#lynx-host");
if (!host) throw new Error("Missing Lynx view host");
const view = document.createElement("lynx-view") as LynxViewElement;

const bridgeModuleUrl = URL.createObjectURL(new Blob([
  `export default function(_nativeModules, nativeModulesCall) {
    return {
      navigate(route) { return nativeModulesCall("navigate", { route }); },
      logout() { return nativeModulesCall("logout", {}); },
      postMessage(text) { return nativeModulesCall("postMessage", { text }); },
      placeZoneNote(zoneKey, text) { return nativeModulesCall("placeZoneNote", { zoneKey, text }); },
      readSiteFile(path, revision, offset) { return nativeModulesCall("readSiteFile", { path, revision, offset }); },
      saveSiteFile(path, content, revision) { return nativeModulesCall("saveSiteFile", { path, content, revision }); },
      publishSite(revision) { return nativeModulesCall("publishSite", { revision }); }
    };
  }`
], { type: "text/javascript" }));

view.style.cssText = "display:block;width:100vw;height:100vh";
view.initData = { route: location.pathname, authenticated: false, canPublishSite: false, compactViewport: window.innerWidth <= 800 };
view.nativeModulesMap = { NetslumHost: bridgeModuleUrl };
view.setAttribute("url", "/main.web.bundle");

// Zone scene canvas: host-owned 2D canvas behind the Lynx view (plan §4.8).
// The Lynx view keeps the synchronized semantic object list.
const zoneCanvas = document.createElement("canvas");
zoneCanvas.id = "netslum-zone-canvas";
zoneCanvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none";
document.body.append(zoneCanvas);
host.style.position = "relative";
host.style.zIndex = "1";
const zoneCtx = zoneCanvas.getContext("2d");
const sceneSeeds = new Map<string, string>();
let sceneKey = "";
let sceneDrawGeneration = 0;

function updateZoneScene(zoneKey: string, objects: unknown[]): void {
  if (!zoneCtx) return;
  sceneKey = zoneKey;
  document.body.classList.toggle("zone-route", true);
  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(window.innerWidth);
  const height = Math.floor(window.innerHeight);
  if (zoneCanvas.width !== width * dpr || zoneCanvas.height !== height * dpr) {
    zoneCanvas.width = width * dpr;
    zoneCanvas.height = height * dpr;
  }
  const drawId = ++sceneDrawGeneration;
  void (async () => {
    let seed = sceneSeeds.get(zoneKey);
    if (!seed) {
      seed = await zoneKeySeed(zoneKey);
      sceneSeeds.set(zoneKey, seed);
    }
    if (sceneKey !== zoneKey || drawId !== sceneDrawGeneration) return;
    zoneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderZoneScene(zoneCtx, zoneKey, seed, sceneParamsFromSeed(seed, width), objects as SceneObject[], width, height);
  })();
}

function clearZoneScene(): void {
  sceneKey = "";
  document.body.classList.toggle("zone-route", false);
  if (zoneCtx) zoneCtx.clearRect(0, 0, zoneCanvas.width, zoneCanvas.height);
}

window.addEventListener("resize", () => {
  if (sceneKey) updateZoneScene(sceneKey, latestZone?.zoneKey === sceneKey ? latestZone.objects : []);
  pushData({ compactViewport: window.innerWidth <= 800 });
});
host.append(view);

// view.updateData crashes with "reading 'enableJSDataProcessor'" when the
// Lynx page config has not loaded yet (race between instance attach and
// first page load). Queue updates until the first successful dispatch.
let viewReady = false;
const pendingUpdates: Array<Record<string, unknown>> = [];
function pushData(data: Record<string, unknown>): void {
  if (!viewReady) {
    pendingUpdates.push(data);
    return;
  }
  view.updateData(data);
}
function flushPendingData(): void {
  while (pendingUpdates.length > 0) {
    view.updateData(pendingUpdates.shift() as Record<string, unknown>);
  }
}

// Probe until the view accepts updates (page config loaded), then flush.
const readyProbe = (): void => {
  const probe = () => view.updateData({ lastUpdatedAt: Date.now() });
  try {
    probe();
    viewReady = true;
    flushPendingData();
  } catch {
    setTimeout(readyProbe, 200);
  }
};
setTimeout(readyProbe, 400);

let currentToolAbort: AbortController | null = null;
let routeGeneration = 0;
let townPoll: ReturnType<typeof setInterval> | null = null;
let zoneSocket: WebSocket | null = null;
let zoneReconnect: ReturnType<typeof setTimeout> | null = null;
let latestZone: ZonePayload | null = null;

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)__Host-netslum-csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function mutationHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-CSRF-Token": getCsrfToken()
  };
}

async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: "same-origin", ...init });
  const payload = await response.json().catch(() => null) as T | ApiErrorPayload | null;
  if (!response.ok) {
    throw new ApiFailure(response.status, (payload ?? {}) as ApiErrorPayload);
  }
  return payload as T;
}

function setStatus(action: ActionStatus["action"], state: ActionStatus["state"], message: string): void {
  const status: ActionStatus = { action, state, message, nonce: Date.now() };
  pushData({ actionStatus: JSON.stringify(status) });
}

function describeFailure(error: unknown): string {
  if (error instanceof ApiFailure) {
    const code = error.payload.code ? `${error.payload.code}: ` : "";
    return `${code}${error.message}`;
  }
  return error instanceof Error ? error.message : "Request failed";
}

function zoneKeyForPath(pathname: string): string | null {
  if (pathname === "/gate") return "hidden.archive.echo";
  return pathname.startsWith("/zone/") ? pathname.slice("/zone/".length) : null;
}

async function refreshTown(): Promise<void> {
  try {
    const feed = await apiJson<{ posts: unknown[]; cursor?: string; stale: boolean }>("/api/feed?limit=5");
    pushData({
      feed: JSON.stringify(feed),
      feedStale: feed.stale,
      routeError: "",
      lastUpdatedAt: Date.now()
    });
  } catch (error) {
    pushData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
  }
}

async function refreshZone(zoneKey: string): Promise<void> {
  try {
    const zone = await apiJson<ZonePayload>(`/api/zones/${encodeURIComponent(zoneKey)}`);
    latestZone = zone;
    updateZoneScene(zoneKey, zone.objects);
    pushData({ zone: JSON.stringify(zone), routeError: "", lastUpdatedAt: Date.now() });
  } catch (error) {
    pushData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
  }
}

function stopLiveUpdates(): void {
  if (townPoll) clearInterval(townPoll);
  townPoll = null;
  if (zoneReconnect) clearTimeout(zoneReconnect);
  zoneReconnect = null;
  if (zoneSocket) {
    zoneSocket.onclose = null;
    zoneSocket.close(1000, "Route changed");
  }
  zoneSocket = null;
  latestZone = null;
}

function connectZoneSocket(zoneKey: string): void {
  if (zoneKeyForPath(location.pathname) !== zoneKey) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/api/zones/${encodeURIComponent(zoneKey)}/socket`);
  zoneSocket = socket;
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; zoneKey?: string; version?: number; objects?: unknown[] };
      if ((message.type === "snapshot" || message.type === "mutation") && message.zoneKey === zoneKey && typeof message.version === "number" && Array.isArray(message.objects)) {
        latestZone = { zoneKey, version: message.version, objects: message.objects };
        updateZoneScene(zoneKey, message.objects);
        pushData({ zone: JSON.stringify(latestZone), routeError: "", lastUpdatedAt: Date.now() });
      }
    } catch (error) {
      console.error("Invalid zone socket message", error);
    }
  };
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    if (zoneKeyForPath(location.pathname) !== zoneKey) return;
    zoneReconnect = setTimeout(() => connectZoneSocket(zoneKey), 1500);
  };
}

function startLiveUpdates(pathname: string): void {
  stopLiveUpdates();
  if (pathname === "/" || pathname === "/town") {
    townPoll = setInterval(() => void refreshTown(), 10_000);
    return;
  }
  const zoneKey = zoneKeyForPath(pathname);
  if (zoneKey) connectZoneSocket(zoneKey);
}

let tenantTools: Array<{ name: string }> = [];

/**
 * Tenant tool manifests (plan §F2): while an authored home or district is
 * mounted, the trusted parent fetches the site's validated webmcp.json and
 * registers each tool as site.<slug>.<name> with a fixed execution endpoint.
 * The iframe never receives the tools permission and never registers tools
 * itself; all tenant tools carry untrustedContentHint. Registration rides
 * the current abort signal so route/session/revision changes tear the set
 * down with the rest.
 */
const registerTenantTools = async (
  slug: string,
  signal: AbortSignal
): Promise<void> => {
  if (typeof document === "undefined" || typeof document.modelContext?.registerTool !== "function") return;
  let manifest: { tools: Array<{ name: string; title?: string; description: string; inputSchema: object }> } | null = null;
  try {
    const response = await fetch(`/api/sites/manifest?slug=${encodeURIComponent(slug)}`, { signal });
    if (response.ok) {
      const body = await response.json() as { manifest: { tools: Array<{ name: string; title?: string; description: string; inputSchema: object }> } | null };
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
      await document.modelContext.registerTool({
        name: `site.${slug}.${tool.name}`,
        title: tool.title ?? tool.name,
        description: tool.description.slice(0, 500),
        inputSchema: tool.inputSchema,
        annotations: { untrustedContentHint: true },
        execute: async (input: unknown): Promise<unknown> => {
          // Fixed execution endpoint (plan §F2): the platform validates and
          // proxies to the isolated tenant runtime; no credentials sent.
          const response = await fetch(`/api/__webmcp/${slug}/${encodeURIComponent(tool.name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input }),
            signal: AbortSignal.timeout(10_000)
          });
          const body: unknown = await response.json().catch(() => ({}));
          if (!response.ok) throw body;
          return body;
        }
      }, { signal });
      tenantTools.push({ name: `site.${slug}.${tool.name}` });
    } catch {
      // A single malformed tool never blocks the others (fail per-tool).
    }
  }
};

/**
 * Authored home (plan §E2): a local member in authored mode mounts their
 * site's home.html from the TENANT origin. The iframe is host-owned; the
 * frozen window.__NETSLUM__ public bridge descriptor is injected there.
 * Standard mode and every failure fall back to the standard home. The DOM
 * element is the single source of truth for the mounted state.
 */
const resolveAuthoredHome = async (signal: AbortSignal): Promise<void> => {
  document.getElementById("authored-home-mount")?.remove();
  tenantTools = [];
  if (location.pathname !== "/") return;
  const mount = await apiJson<{ mode: string; tenantOrigin?: string; path?: string; title?: string }>("/api/home/mount");
  if (mount.mode !== "authored" || !mount.tenantOrigin || !mount.path) return;
  const iframe = document.createElement("iframe");
  iframe.id = "authored-home-mount";
  iframe.title = mount.title ?? "authored home";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.setAttribute("allow", "webgpu");
  iframe.src = `${mount.tenantOrigin}${mount.path}`;
  iframe.style.cssText = "position:fixed;inset:52px 0 0 0;width:100vw;height:calc(100vh - 52px);border:none;background:#070910;z-index:5;";
  document.body.appendChild(iframe);
  // Register the site's tenant tools while mounted (plan §F2).
  const slug = new URL(mount.tenantOrigin).hostname.split(".")[0];
  if (slug) await registerTenantTools(slug, signal);
};

const syncRoute = async (): Promise<void> => {
  const generation = ++routeGeneration;
  const pathname = location.pathname;
  let session: SessionInfo = { authenticated: false };
  try {
    session = await apiJson<SessionInfo>("/api/session");
  } catch (error) {
    pushData({ routeError: describeFailure(error) });
  }
  if (generation !== routeGeneration) return;

  currentToolAbort?.abort();
  currentToolAbort = new AbortController();
  registerNetslumTools(navigate, session, currentToolAbort.signal);
  pushData({ route: pathname, ...session, routeError: "" });

  if (pathname === "/" || pathname === "/town") await refreshTown();
  const zoneKey = zoneKeyForPath(pathname);
  if (zoneKey) await refreshZone(zoneKey);
  else clearZoneScene();
  await resolveAuthoredHome(currentToolAbort.signal);
  if (pathname.startsWith("/profile/") && session.authenticated !== undefined) {
    const actor = decodeURIComponent(pathname.slice("/profile/".length));
    try {
      const profile = await apiJson<{ did: string; handle: string; displayName?: string; description?: string; siteUrl?: string | null }>(
        `/api/profile/${encodeURIComponent(actor)}`
      );
      pushData({ profile: JSON.stringify(profile), routeError: "", lastUpdatedAt: Date.now() });
    } catch (error) {
      pushData({ profile: "", routeError: describeFailure(error), lastUpdatedAt: Date.now() });
    }
  }
  if (pathname === "/studio" && session.authenticated) {
    try {
      const site = await apiJson<{ slug: string; revision: string; files: Array<{ path: string }> }>("/api/sites/draft");
      pushData({ site: JSON.stringify(site), routeError: "", lastUpdatedAt: Date.now() });
      const indexFile = site.files.find((file) => file.path === "index.html") ?? site.files[0];
      if (indexFile) {
        const file = await apiJson<SiteFileRead>(`/api/sites/file?path=${encodeURIComponent(indexFile.path)}&offset=0&maxChars=1000`);
        pushData({ editorChunk: JSON.stringify(file) });
      }
    } catch (error) {
      pushData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
    }
  }
  if (generation === routeGeneration) startLiveUpdates(pathname);
};

const navigate = (route: string): void => {
  if (!route.startsWith("/")) return;
  if (route === "/oauth/login" || route.startsWith("/@")) {
    location.assign(route);
    return;
  }
  if (route !== location.pathname) history.pushState({}, "", route);
  void syncRoute();
};

view.onNativeModulesCall = async (name, data, moduleName) => {
  if (moduleName !== "NetslumHost") return;
  const input = data as Record<string, unknown> | undefined;

  if (name === "navigate" && typeof input?.route === "string") {
    navigate(input.route);
    return;
  }

  if (name === "logout") {
    setStatus("logout", "busy", "Signing out…");
    try {
      await apiJson("/api/auth/logout", { method: "POST", headers: mutationHeaders() });
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
      const prepare = (expectedRevision: string | null) => apiJson<{ draftRevision: string }>("/api/post-draft", {
        method: "PUT",
        headers: mutationHeaders(),
        body: JSON.stringify({ text: input.text, expectedRevision })
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
      await refreshTown();
    } catch (error) {
      setStatus("post", "error", describeFailure(error));
    }
    return;
  }

  if (name === "placeZoneNote" && typeof input?.zoneKey === "string" && typeof input?.text === "string") {
    setStatus("zone", "busy", "Dropping note…");
    try {
      const zoneKey = input.zoneKey;
      const zone = latestZone?.zoneKey === zoneKey
        ? latestZone
        : await apiJson<ZonePayload>(`/api/zones/${encodeURIComponent(zoneKey)}`);
      await apiJson(`/api/zones/${encodeURIComponent(zoneKey)}/mutations`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          expectedVersion: zone.version,
          operations: [{
            op: "place",
            object: {
              type: "note",
              x: Math.floor(Math.random() * 800) + 100,
              y: Math.floor(Math.random() * 800) + 100,
              text: input.text
            }
          }]
        })
      });
      setStatus("zone", "success", "Note dropped");
      await refreshZone(zoneKey);
    } catch (error) {
      setStatus("zone", "error", describeFailure(error));
    }
    return;
  }

  if (name === "readSiteFile" && typeof input?.path === "string" && typeof input?.offset === "number") {
    try {
      const file = await apiJson<SiteFileRead>(`/api/sites/file?path=${encodeURIComponent(input.path)}&offset=${input.offset}&maxChars=1000`);
      pushData({ editorChunk: JSON.stringify(file) });
    } catch (error) {
      setStatus("site", "error", describeFailure(error));
    }
    return;
  }

  if (name === "saveSiteFile" && typeof input?.path === "string" && typeof input?.content === "string" && typeof input?.revision === "string") {
    setStatus("site", "busy", `Saving ${input.path}…`);
    try {
      const saved = await apiJson<{ revision: string }>("/api/sites/file", {
        method: "PUT",
        headers: mutationHeaders(),
        body: JSON.stringify({
          path: input.path,
          content: input.content,
          encoding: "utf8",
          contentType: input.path.endsWith(".html") ? "text/html" : "text/javascript",
          expectedRevision: input.revision
        })
      });
      setStatus("site", "success", `${input.path} saved`);
      pushData({ editorRevision: saved.revision, editorChunk: "" });
      await syncRoute();
    } catch (error) {
      setStatus("site", "error", describeFailure(error));
    }
    return;
  }

  if (name === "publishSite" && typeof input?.revision === "string") {
    setStatus("site", "busy", "Publishing site…");
    try {
      const published = await apiJson<{ url: string }>("/api/sites/publish", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ revision: input.revision })
      });
      setStatus("site", "success", `Site published — ${published.url}`);
      await syncRoute();
    } catch (error) {
      setStatus("site", "error", describeFailure(error));
    }
  }
};

window.addEventListener("netslum:state", (event) => {
  const detail = (event as CustomEvent<{ action: string; data: unknown }>).detail;
  pushData({ lastAction: detail.action, actionData: JSON.stringify(detail.data) });
  if (location.pathname === "/town") void refreshTown();
});
window.addEventListener("popstate", () => void syncRoute());
window.addEventListener("netslum:navigate", (event) => navigate((event as CustomEvent<{ route: string }>).detail.route));
window.addEventListener("pagehide", () => {
  stopLiveUpdates();
  currentToolAbort?.abort();
  URL.revokeObjectURL(bridgeModuleUrl);
}, { once: true });

void syncRoute();
