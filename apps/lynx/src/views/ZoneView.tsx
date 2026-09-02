import type { LynxInputEvent, ZoneObjectItem } from "./types.js";
import { FEATURED_ZONES } from "./types.js";

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
        <text className="title">&Delta; {activeZoneKey}</text>
        <text className="copy">State Version {zoneVersion} &bull; {zoneObjects.length} Objects Active</text>
        <text className="zone-scene-hint">DETERMINISTIC SECTOR RENDER // SHA-256 SEEDED // ALL TRAVELERS SEE THE SAME SPACE</text>
      </view>
      <view className={activePane === "feed" || !compact ? "split-feed" : "split-feed pane-hidden"}>
        <text className="kicker">SECTOR RAIL</text>
        <view className="zone-grid-view">
          <text className="section-title">// DROPPED NOTES & ARTIFACTS</text>
          <view className="objects-grid">
            {zoneObjects.length > 0 ? (
              zoneObjects.map((o) => (
                <view key={o.id} className="object-card">
                  <text className="object-type">[{o.type.toUpperCase()}] ({o.x}, {o.y})</text>
                  <text className="object-content">{o.text || o.shape || o.targetZoneKey || "artifact"}</text>
                </view>
              ))
            ) : (
              <view className="empty-card">
                <text className="empty-text">This sector is silent. Leave a note or sigil below.</text>
              </view>
            )}
          </view>
        </view>

        {authenticated ? (
          <view className="composer-card">
            <text className="composer-label">DROP A NOTE IN THIS SECTOR</text>
            <input
              className="composer-input"
              placeholder="Inscribe a message for other travelers..."
              value={noteText}
              bindinput={(e: LynxInputEvent) => setNoteText(e.detail.value)}
            />
            <view className="composer-footer">
              <text className={zoneBusy ? "primary-sm busy" : "primary-sm"} bindtap={() => submitNote(activeZoneKey)}>{zoneBusy ? "DROPPING…" : "DROP NOTE"}</text>
            </view>
          </view>
        ) : null}

        <view className="featured-section">
          <text className="section-title">// OTHER DESTINATIONS</text>
          <view className="portal-grid">
            {FEATURED_ZONES.filter(z => z !== activeZoneKey).map((z) => (
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