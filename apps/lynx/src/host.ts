/**
 * Netslum Lynx Host Entry Point
 *
 * Orchestrates:
 * - LynxView element creation and mount
 * - NetslumHost NativeModules bridge
 * - 2D Zone canvas background rendering
 * - Real-time zone WebSocket & town polling
 * - District / Authored home / Studio iframes with WebGPU & WebMCP
 * - Inline HLS video player
 * - Client-side SPA routing & data synchronization
 */

import { host, view, state, pushData, flushPendingData } from "./host/state.js";
import { initZoneCanvas, updateZoneScene } from "./host/zoneCanvas.js";
import { stopLiveUpdates, refreshTown } from "./host/liveUpdates.js";
import { initTrustedActionReceiver, resolveStudioMount } from "./host/mounts.js";
import { navigate, syncRoute } from "./host/router.js";
import { createBridgeBlobUrl, handleNativeModulesCall } from "./host/bridge.js";

// 1. Initialize native bridge module
state.bridgeModuleUrl = createBridgeBlobUrl();

// 2. Configure LynxView element
view.style.cssText = "display:block;width:100vw;height:100vh";
view.initData = {
  route: location.pathname + location.search,
  authenticated: false,
  canPublishSite: false,
  compactViewport: window.innerWidth <= 800
};
view.nativeModulesMap = { NetslumHost: state.bridgeModuleUrl };
view.setAttribute("url", "/main.web.bundle");

// 3. Attach NativeModules dispatch
view.onNativeModulesCall = handleNativeModulesCall;

// 4. Initialize background 2D zone canvas
initZoneCanvas();

// 5. Mount Lynx view to DOM host
host.append(view);

// 6. Readiness fallback: if bundle never boots after 30s, force viewReady
// so data queues don't deadlock silently.
setTimeout(() => {
  if (!state.viewReady) {
    console.warn("[netslum] appReady never received — forcing viewReady after 30s fallback");
    state.viewReady = true;
    flushPendingData();
  }
}, 30_000);

// 7. Window and lifecycle event listeners
window.addEventListener("resize", () => {
  if (state.sceneKey) {
    updateZoneScene(state.sceneKey, state.latestZone?.zoneKey === state.sceneKey ? state.latestZone.objects : []);
  }
  pushData({ compactViewport: window.innerWidth <= 800 });
});

window.addEventListener("netslum:state", (event) => {
  const detail = (event as CustomEvent<{ action: string; data: unknown }>).detail;
  pushData({ lastAction: detail.action, actionData: JSON.stringify(detail.data) });
  if (detail.action === "set_home_layout") void syncRoute();
  if (location.pathname === "/studio") void resolveStudioMount();
  if (location.pathname === "/" || location.pathname === "/town") void refreshTown();
});

window.addEventListener("popstate", () => void syncRoute());
window.addEventListener("netslum:navigate", (event) => navigate((event as CustomEvent<{ route: string }>).detail.route));

initTrustedActionReceiver(navigate);

window.addEventListener(
  "pagehide",
  () => {
    stopLiveUpdates();
    state.currentToolAbort?.abort();
    if (state.bridgeModuleUrl) URL.revokeObjectURL(state.bridgeModuleUrl);
  },
  { once: true }
);

// 8. Initial route sync
void syncRoute();
