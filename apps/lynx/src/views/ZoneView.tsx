import type { ZoneObjectItem } from "./types.js";
import { FEATURED_ZONES, zoneDisplayTitle } from "./types.js";

export interface ZoneViewProps {
  compact: boolean;
  activePane: "world" | "feed";
  setActivePane: (pane: "world" | "feed") => void;
  activeZoneKey: string;
  zoneVersion: number;
  zoneObjects: ZoneObjectItem[];
  authenticated: boolean;
  noteText: string;
  setNoteText: (value: string) => void;
  zoneBusy: boolean;
  submitNote: (zoneKey: string) => void;
  navigate: (route: string) => void;
}

export function ZoneView(props: ZoneViewProps) {
  const {
    compact,
    activePane,
    setActivePane,
    activeZoneKey,
    zoneVersion,
    zoneObjects,
    authenticated,
    noteText,
    setNoteText,
    zoneBusy,
    submitNote,
    navigate
  } = props;

  const districtPortals = zoneObjects.filter((o) => o.experience || o.type === "portal" || o.shape === "portal");
  const otherObjects = zoneObjects.filter((o) => !o.experience && o.type !== "portal" && o.shape !== "portal");

  return (
    <view className={compact ? "split-layout compact" : "split-layout"}>
      {compact ? (
        <view className="pane-tabs">
          <text className={activePane === "world" ? "pane-tab active" : "pane-tab"} bindtap={() => setActivePane("world")}>WORLD</text>
          <text className={activePane === "feed" ? "pane-tab active" : "pane-tab"} bindtap={() => setActivePane("feed")}>FEED</text>
        </view>
      ) : null}

      <view className={activePane === "world" || !compact ? "split-world" : "split-world pane-hidden"}>
        <text className="kicker">CHAOS GATE // WORLD</text>
        <text className="title">{zoneDisplayTitle(activeZoneKey)}</text>
        {zoneObjects.length === 0 ? (
          <view>
            <text className="unclaimed-badge">UNCLAIMED</text>
            <text className="copy">This keyword combination has no objects yet &mdash; the first traveler to drop a note claims it.</text>
          </view>
        ) : (
          <text className="copy">State Version {zoneVersion} &bull; {zoneObjects.length} Objects Active</text>
        )}
        <text className="zone-scene-hint">DETERMINISTIC SECTOR RENDER // SHA-256 SEEDED // ALL TRAVELERS SEE THE SAME SPACE</text>
      </view>

      <view className={activePane === "feed" || !compact ? "split-feed" : "split-feed pane-hidden"}>
        <text className="kicker">SECTOR RAIL</text>

        {/* DISTRICT & PORTAL OBJECTS */}
        {districtPortals.length > 0 ? (
          <view className="zone-grid-view">
            <text className="section-title">// DISTRICT PORTALS & WARP GATES</text>
            <view className="objects-grid">
              {districtPortals.map((o) => (
                <view key={o.id} className="portal-object-card">
                  {o.experience ? (
                    <view className="portal-exp-block">
                      <view className="portal-exp-header">
                        <text className="portal-exp-title">{o.experience.title || `@${o.experience.siteSlug}`}</text>
                        <text className="district-gpu-badge">⚡ WebGPU</text>
                      </view>
                      <text className="portal-exp-slug">District @{o.experience.siteSlug} ({o.experience.path || "index.html"})</text>
                      <text
                        className="primary-sm"
                        bindtap={() => navigate(`/district/${encodeURIComponent(o.experience!.siteSlug)}${o.experience!.path ? `?path=${encodeURIComponent(o.experience!.path)}` : ""}`)}
                      >
                        ENTER DISTRICT &rarr;
                      </text>
                    </view>
                  ) : o.targetZoneKey ? (
                    <view className="portal-warp-block" bindtap={() => navigate(`/zone/${o.targetZoneKey}`)}>
                      <text className="portal-name">&Delta; {o.targetZoneKey}</text>
                      <text className="secondary-sm">WARP TO SECTOR &rarr;</text>
                    </view>
                  ) : (
                    <view className="object-card">
                      <text className="object-type">[PORTAL] ({o.x}, {o.y})</text>
                      <text className="object-content">{o.text || "Unlinked Portal"}</text>
                    </view>
                  )}
                </view>
              ))}
            </view>
          </view>
        ) : null}

        {/* DROPPED NOTES & ARTIFACTS */}
        <view className="zone-grid-view">
          <text className="section-title">// DROPPED NOTES & ARTIFACTS</text>
          <view className="objects-grid">
            {otherObjects.length > 0 ? (
              otherObjects.map((o) => (
                <view key={o.id} className="object-card">
                  <text className="object-type">[{o.type.toUpperCase()}] ({o.x}, {o.y})</text>
                  <text className="object-content">{o.text || o.shape || "artifact"}</text>
                </view>
              ))
            ) : districtPortals.length === 0 ? (
              <view className="empty-card">
                <text className="empty-text">This sector is unclaimed. Leave a note or sigil below.</text>
              </view>
            ) : null}
          </view>
        </view>

        {authenticated ? (
          <view className="composer-card">
            <text className="composer-label">DROP A NOTE IN THIS SECTOR</text>
            <input
              className="composer-input"
              placeholder="Inscribe a message for other travelers..."
              default-value={noteText}
              bindinput={(e) => setNoteText(e.detail.value)}
            />
            <view className="composer-footer">
              <text className={zoneBusy ? "primary-sm busy" : "primary-sm"} bindtap={() => submitNote(activeZoneKey)}>
                {zoneBusy ? "DROPPING…" : "DROP NOTE"}
              </text>
            </view>
          </view>
        ) : null}

        <view className="featured-section">
          <text className="section-title">// OTHER DESTINATIONS</text>
          <view className="portal-grid">
            {FEATURED_ZONES.filter((z) => z !== activeZoneKey).map((z) => (
              <view key={z} className="portal-card" bindtap={() => navigate(`/zone/${z}`)}>
                <text className="portal-name">&Delta; {z}</text>
              </view>
            ))}
          </view>
        </view>
      </view>
    </view>
  );
}
