import type { LynxViewElement } from "@lynx-js/web-core/client";
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
view.initData = { route: location.pathname, authenticated: false, canPublishSite: false };
view.nativeModulesMap = { NetslumHost: bridgeModuleUrl };
view.setAttribute("url", "/main.web.bundle");
host.append(view);

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
  view.updateData({ actionStatus: JSON.stringify(status) });
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
    view.updateData({
      feed: JSON.stringify(feed),
      feedStale: feed.stale,
      routeError: "",
      lastUpdatedAt: Date.now()
    });
  } catch (error) {
    view.updateData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
  }
}

async function refreshZone(zoneKey: string): Promise<void> {
  try {
    const zone = await apiJson<ZonePayload>(`/api/zones/${encodeURIComponent(zoneKey)}`);
    latestZone = zone;
    view.updateData({ zone: JSON.stringify(zone), routeError: "", lastUpdatedAt: Date.now() });
  } catch (error) {
    view.updateData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
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
        view.updateData({ zone: JSON.stringify(latestZone), routeError: "", lastUpdatedAt: Date.now() });
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

const syncRoute = async (): Promise<void> => {
  const generation = ++routeGeneration;
  const pathname = location.pathname;
  let session: SessionInfo = { authenticated: false };
  try {
    session = await apiJson<SessionInfo>("/api/session");
  } catch (error) {
    view.updateData({ routeError: describeFailure(error) });
  }
  if (generation !== routeGeneration) return;

  currentToolAbort?.abort();
  currentToolAbort = new AbortController();
  registerNetslumTools(navigate, session, currentToolAbort.signal);
  view.updateData({ route: pathname, ...session, routeError: "" });

  if (pathname === "/" || pathname === "/town") await refreshTown();
  const zoneKey = zoneKeyForPath(pathname);
  if (zoneKey) await refreshZone(zoneKey);
  if (pathname === "/studio" && session.authenticated) {
    try {
      const site = await apiJson<{ slug: string; revision: string; files: Array<{ path: string }> }>("/api/sites/draft");
      view.updateData({ site: JSON.stringify(site), routeError: "", lastUpdatedAt: Date.now() });
      const indexFile = site.files.find((file) => file.path === "index.html") ?? site.files[0];
      if (indexFile) {
        const file = await apiJson<SiteFileRead>(`/api/sites/file?path=${encodeURIComponent(indexFile.path)}&offset=0&maxChars=1000`);
        view.updateData({ editorChunk: JSON.stringify(file) });
      }
    } catch (error) {
      view.updateData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
    }
  }
  if (generation === routeGeneration) startLiveUpdates(pathname);
};

const navigate = (route: string): void => {
  if (!route.startsWith("/")) return;
  if (route === "/oauth/login") {
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
      view.updateData({ editorChunk: JSON.stringify(file) });
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
      view.updateData({ editorRevision: saved.revision, editorChunk: "" });
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
  view.updateData({ lastAction: detail.action, actionData: JSON.stringify(detail.data) });
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
