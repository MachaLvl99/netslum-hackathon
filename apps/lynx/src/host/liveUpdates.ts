import type { ZonePayload } from "./types.js";
import { state, pushData } from "./state.js";
import { apiJson, describeFailure, loadTimelinePage } from "./api.js";
import { updateZoneScene, zoneKeyForPath } from "./zoneCanvas.js";

export async function refreshTown(): Promise<void> {
  try {
    const feed = await apiJson<{ posts: Array<{ uri: string; createdAt: string }>; cursor?: string; stale: boolean }>("/api/feed?limit=25");
    let posts = feed.posts;
    // The homepage combines the town square with the followed timeline.
    if (location.pathname === "/") {
      const timeline = await loadTimelinePage();
      if (timeline) {
        const seen = new Set(posts.map((p) => p.uri));
        const merged = [...posts];
        for (const p of timeline) {
          if (!seen.has(p.uri)) merged.push(p as never);
        }
        merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        posts = merged as never;
      }
    }
    pushData({
      feed: JSON.stringify({ ...feed, posts }),
      feedStale: feed.stale,
      routeError: "",
      lastUpdatedAt: Date.now()
    });
  } catch (error) {
    pushData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
  }
}

export async function refreshZone(zoneKey: string): Promise<void> {
  try {
    const zone = await apiJson<ZonePayload>(`/api/zones/${encodeURIComponent(zoneKey)}`);
    state.latestZone = zone;
    updateZoneScene(zoneKey, zone.objects);
    pushData({ zone: JSON.stringify(zone), routeError: "", lastUpdatedAt: Date.now() });
  } catch (error) {
    pushData({ routeError: describeFailure(error), lastUpdatedAt: Date.now() });
  }
}

export function stopLiveUpdates(): void {
  if (state.townPoll !== null) {
    clearInterval(state.townPoll);
    state.townPoll = null;
  }
  if (state.zoneReconnect !== null) {
    clearTimeout(state.zoneReconnect);
    state.zoneReconnect = null;
  }
  if (state.zoneSocket) {
    state.zoneSocket.onclose = null;
    state.zoneSocket.close(1000, "Route changed");
    state.zoneSocket = null;
  }
  state.latestZone = null;
}

export function connectZoneSocket(zoneKey: string): void {
  if (zoneKeyForPath(location.pathname) !== zoneKey) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/api/zones/${encodeURIComponent(zoneKey)}/socket`);
  state.zoneSocket = socket;

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; zoneKey?: string; version?: number; objects?: unknown[] };
      if ((message.type === "snapshot" || message.type === "mutation") && message.zoneKey === zoneKey && typeof message.version === "number" && Array.isArray(message.objects)) {
        state.latestZone = { zoneKey, version: message.version, objects: message.objects };
        updateZoneScene(zoneKey, message.objects);
        pushData({ zone: JSON.stringify(state.latestZone), routeError: "", lastUpdatedAt: Date.now() });
      }
    } catch (error) {
      console.error("Invalid zone socket message", error);
    }
  };

  socket.onerror = () => socket.close();
  socket.onclose = () => {
    if (zoneKeyForPath(location.pathname) !== zoneKey) return;
    state.zoneReconnect = setTimeout(() => connectZoneSocket(zoneKey), 1500);
  };
}

export function startLiveUpdates(pathname: string): void {
  stopLiveUpdates();
  if (pathname === "/" || pathname === "/town") {
    state.townPoll = setInterval(() => void refreshTown(), 10_000);
    return;
  }
  const zoneKey = zoneKeyForPath(pathname);
  if (zoneKey) connectZoneSocket(zoneKey);
}
