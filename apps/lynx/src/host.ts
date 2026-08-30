import type { LynxViewElement } from "@lynx-js/web-core/client";
import { registerNetslumTools, type SessionInfo } from "./webmcp.js";

const host = document.querySelector<HTMLElement>("#lynx-host");
if (!host) throw new Error("Missing Lynx view host");
const view = document.createElement("lynx-view") as LynxViewElement;

const bridgeModuleUrl = URL.createObjectURL(new Blob([
  `export default function(_nativeModules, nativeModulesCall) {
    return { navigate(route) { return nativeModulesCall("navigate", { route }); } };
  }`
], { type: "text/javascript" }));

const navigate = (route: string): void => {
  if (!route.startsWith("/")) return;
  if (route === "/oauth/login") {
    location.assign("/oauth/login");
    return;
  }
  history.pushState({}, "", route);
  void syncRoute();
};

view.onNativeModulesCall = (name, data, moduleName) => {
  if (moduleName !== "NetslumHost" || name !== "navigate") return;
  const input = data as { route?: unknown } | undefined;
  if (typeof input?.route === "string") navigate(input.route);
};
view.style.cssText = "display:block;width:100vw;height:100vh";
view.initData = { route: location.pathname, authenticated: false, canPublishSite: false };
view.nativeModulesMap = { NetslumHost: bridgeModuleUrl };
view.setAttribute("url", "/main.web.bundle");
host.append(view);

let currentToolAbort: AbortController | null = null;

const syncRoute = async (): Promise<void> => {
  let session: SessionInfo = { authenticated: false };
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    if (response.ok) session = await response.json() as typeof session;
  } catch { /* Shell stays usable while the session endpoint is unavailable. */ }
  
  currentToolAbort?.abort();
  currentToolAbort = new AbortController();
  registerNetslumTools(navigate, session, currentToolAbort.signal);
  view.updateData({ route: location.pathname, ...session });
};

window.addEventListener("netslum:state", (event) => {
  const detail = (event as CustomEvent<{ action: string; data: unknown }>).detail;
  view.updateData({ lastAction: detail.action, actionData: JSON.stringify(detail.data) });
});

window.addEventListener("popstate", () => { void syncRoute(); });
window.addEventListener("netslum:navigate", (event) => navigate((event as CustomEvent<{ route: string }>).detail.route));
window.addEventListener("pagehide", () => URL.revokeObjectURL(bridgeModuleUrl), { once: true });

void syncRoute();
