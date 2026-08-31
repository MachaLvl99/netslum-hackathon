import type { LynxViewElement } from "@lynx-js/web-core/client";
import { registerNetslumTools, type SessionInfo } from "./webmcp.js";

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
      saveSiteFile(path, content, revision) { return nativeModulesCall("saveSiteFile", { path, content, revision }); },
      publishSite(revision) { return nativeModulesCall("publishSite", { revision }); }
    };
  }`
], { type: "text/javascript" }));

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)__Host-netslum-csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

const navigate = (route: string): void => {
  if (!route.startsWith("/")) return;
  if (route === "/oauth/login") {
    location.assign("/oauth/login");
    return;
  }
  history.pushState({}, "", route);
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
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": getCsrfToken() }
      });
    } catch (e) {
      void e;
    }
    navigate("/");
    return;
  }

  if (name === "postMessage" && typeof input?.text === "string") {
    try {
      const draftRes = await fetch("/api/post-draft", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfToken() },
        body: JSON.stringify({ text: input.text, expectedRevision: null })
      });
      if (draftRes.ok) {
        const draft = (await draftRes.json()) as { draftRevision: string };
        await fetch("/api/posts/publish", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfToken() },
          body: JSON.stringify({ draftRevision: draft.draftRevision })
        });
      }
    } catch (e) {
      void e;
    }
    void syncRoute();
    return;
  }

  if (name === "placeZoneNote" && typeof input?.zoneKey === "string" && typeof input?.text === "string") {
    try {
      const current = await fetch(`/api/zones/${encodeURIComponent(input.zoneKey)}`).then((r) => r.json() as Promise<{ version: number }>);
      await fetch(`/api/zones/${encodeURIComponent(input.zoneKey)}/mutations`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfToken() },
        body: JSON.stringify({
          expectedVersion: current.version ?? 0,
          operations: [
            {
              op: "place",
              object: { type: "note", x: Math.floor(Math.random() * 800) + 100, y: Math.floor(Math.random() * 600) + 100, text: input.text }
            }
          ]
        })
      });
    } catch (e) {
      void e;
    }
    void syncRoute();
    return;
  }

  if (name === "saveSiteFile" && typeof input?.path === "string" && typeof input?.content === "string") {
    try {
      await fetch("/api/sites/file", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfToken() },
        body: JSON.stringify({
          path: input.path,
          content: input.content,
          encoding: "utf8",
          contentType: input.path.endsWith(".html") ? "text/html" : "text/javascript",
          expectedRevision: typeof input.revision === "string" ? input.revision : undefined
        })
      });
    } catch (e) {
      void e;
    }
    void syncRoute();
    return;
  }

  if (name === "publishSite" && typeof input?.revision === "string") {
    try {
      await fetch("/api/sites/publish", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfToken() },
        body: JSON.stringify({ revision: input.revision })
      });
    } catch (e) {
      void e;
    }
    void syncRoute();
    return;
  }
};

view.style.cssText = "display:block;width:100vw;height:100vh";
view.initData = { route: location.pathname, authenticated: false, canPublishSite: false };
view.nativeModulesMap = { NetslumHost: bridgeModuleUrl };
view.setAttribute("url", "/main.web.bundle");
host.append(view);

let currentToolAbort: AbortController | null = null;

const syncRoute = async (): Promise<void> => {
  const pathname = location.pathname;
  let session: SessionInfo = { authenticated: false };
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    if (response.ok) session = (await response.json()) as typeof session;
  } catch (e) {
    void e;
  }

  let feedData: unknown = null;
  let zoneData: unknown = null;
  let siteData: unknown = null;

  try {
    if (pathname === "/" || pathname === "/town") {
      const res = await fetch("/api/feed?limit=5");
      if (res.ok) feedData = await res.json();
    }
  } catch (e) {
    void e;
  }

  try {
    if (pathname.startsWith("/zone/") || pathname === "/gate") {
      const zoneKey = pathname.startsWith("/zone/") ? pathname.slice(6) : "hidden.archive.echo";
      const res = await fetch(`/api/zones/${encodeURIComponent(zoneKey)}`);
      if (res.ok) zoneData = await res.json();
    }
  } catch (e) {
    void e;
  }

  try {
    if (pathname === "/studio" && session.authenticated) {
      const res = await fetch("/api/sites/draft", { credentials: "same-origin" });
      if (res.ok) siteData = await res.json();
    }
  } catch (e) {
    void e;
  }

  currentToolAbort?.abort();
  currentToolAbort = new AbortController();
  registerNetslumTools(navigate, session, currentToolAbort.signal);

  view.updateData({
    route: pathname,
    ...session,
    feed: feedData ? JSON.stringify(feedData) : undefined,
    zone: zoneData ? JSON.stringify(zoneData) : undefined,
    site: siteData ? JSON.stringify(siteData) : undefined
  });
};

window.addEventListener("netslum:state", (event) => {
  const detail = (event as CustomEvent<{ action: string; data: unknown }>).detail;
  view.updateData({ lastAction: detail.action, actionData: JSON.stringify(detail.data) });
  void syncRoute();
});

window.addEventListener("popstate", () => {
  void syncRoute();
});
window.addEventListener("netslum:navigate", (event) => navigate((event as CustomEvent<{ route: string }>).detail.route));
window.addEventListener("pagehide", () => URL.revokeObjectURL(bridgeModuleUrl), { once: true });

void syncRoute();
