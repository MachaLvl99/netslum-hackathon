import type { LynxViewElement } from "@lynx-js/web-core/client";
import type { LynxDataRecord, ZonePayload } from "./types.js";
import type { SessionInfo } from "../webmcp.js";

// DOM Host and LynxView element
const hostElement = document.querySelector<HTMLElement>("#lynx-host");
if (!hostElement) throw new Error("Missing Lynx view host");
export const host: HTMLElement = hostElement;
export const view: LynxViewElement = document.createElement("lynx-view") as LynxViewElement;
export type TimerHandle = ReturnType<typeof setTimeout>;

export const state = {
  viewReady: false,
  pendingUpdates: [] as LynxDataRecord[],
  routeGeneration: 0,
  currentToolAbort: null as AbortController | null,
  townPoll: null as TimerHandle | null,
  zoneSocket: null as WebSocket | null,
  zoneReconnect: null as TimerHandle | null,
  latestZone: null as ZonePayload | null,
  cachedSession: null as { data: SessionInfo; ts: number } | null,
  headerAvatarCache: { did: "", url: "" },
  conversationRecipients: new Map<string, string[]>(),
  currentConversations: [] as Array<{ convoId: string; unreadCount: number }>,
  tenantTools: [] as Array<{ name: string }>,
  activeTenantOrigin: null as string | null,
  sceneKey: "",
  sceneDrawGeneration: 0,
  bridgeModuleUrl: ""
};

export function pushData(data: LynxDataRecord): void {
  if (!state.viewReady) {
    state.pendingUpdates.push(data);
    return;
  }
  view.updateData(data as never);
}

export function flushPendingData(): void {
  while (state.pendingUpdates.length > 0) {
    view.updateData(state.pendingUpdates.shift() as never);
  }
}
