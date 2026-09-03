import { useState } from "@lynx-js/react";
import type { HomeSettings } from "./types.js";

export interface SettingsViewProps {
  authenticated: boolean;
  did?: string | undefined;
  handle?: string | undefined;
  canPublishSite?: boolean | undefined;
  canAuthorHome?: boolean | undefined;
  canUseDms?: boolean | undefined;
  canUploadVideo?: boolean | undefined;
  dmAgentEnabled?: boolean | undefined;
  scopeVersion?: number | undefined;
  reauthorizeRequired?: boolean | undefined;
  homeSettings?: HomeSettings | null | undefined;
  chatDeclaration?: string | null | undefined;
  onToggleDmAgent?: ((enabled: boolean) => void) | undefined;
  onUpdateChatDeclaration?: ((allowIncoming: "all" | "following" | "none") => void) | undefined;
  onSaveHomeSettings?: ((mode: "standard" | "authored", activeHomePath: string | null) => void) | undefined;
  onLogout?: (() => void) | undefined;
  navigate: (route: string) => void;
}

export function SettingsView(props: SettingsViewProps) {
  const {
    authenticated,
    did,
    handle,
    canUseDms,
    canUploadVideo,
    dmAgentEnabled = false,
    scopeVersion,
    reauthorizeRequired = false,
    homeSettings,
    chatDeclaration = "following",
    onToggleDmAgent,
    onUpdateChatDeclaration,
    onSaveHomeSettings,
    onLogout,
    navigate
  } = props;

  const [selectedHomeMode, setSelectedHomeMode] = useState<"standard" | "authored">(
    homeSettings?.mode ?? "standard"
  );


  if (!authenticated) {
    return (
      <view className="content">
        <text className="kicker">SYSTEM SETTINGS</text>
        <text className="title">authentication required</text>
        <view className="action-row">
          <text className="primary" bindtap={() => navigate("/oauth/login")}>
            SIGN IN WITH AT PROTOCOL &rarr;
          </text>
        </view>
      </view>
    );
  }

  return (
    <view className="content">
      <text className="kicker">SYSTEM SETTINGS // CONTROL PANEL</text>
      <text className="title">preferences & capabilities</text>

      {reauthorizeRequired ? (
        <view className="notice-card warning">
          <text className="notice-title">⚠️ REAUTHORIZATION REQUIRED</text>
          <text className="notice-text">
            Your current OAuth session was issued under an earlier permission version (or missing required Phase 2 scopes).
            Please sign in again to reauthorize chat and proxy capabilities.
          </text>
          <view className="notice-action">
            <text className="primary-sm" bindtap={() => navigate("/oauth/login")}>
              REAUTHORIZE NOW &rarr;
            </text>
          </view>
        </view>
      ) : null}

      {/* WEBMCP DIRECT MESSAGES AGENT ACCESS */}
      <view className="settings-card">
        <text className="section-title">// WEBMCP AGENT DIRECT MESSAGES (OPT-IN)</text>
        <text className="copy-sm">
          Allow local desktop AI agents (Codex, Claude, etc.) to list, prepare, and draft direct messages via WebMCP tools.
          Disabled by default for security and privacy.
        </text>
        <view className="setting-row">
          <view className="setting-label-block">
            <text className="setting-name">DM Agent Tool Registration</text>
            <text className="setting-desc">Status: {dmAgentEnabled ? "ENABLED" : "DISABLED"}</text>
          </view>
          {onToggleDmAgent ? (
            <text
              className={dmAgentEnabled ? "toggle-btn active" : "toggle-btn"}
              bindtap={() => onToggleDmAgent(!dmAgentEnabled)}
            >
              {dmAgentEnabled ? "ENABLED [ON]" : "DISABLED [OFF]"}
            </text>
          ) : null}
        </view>
      </view>

      {/* DIRECT MESSAGES INCOMING PRIVACY */}
      <view className="settings-card">
        <text className="section-title">// DIRECT MESSAGES PRIVACY (DECLARATION)</text>
        <text className="copy-sm">
          Configure who is allowed to send you incoming direct messages on the Bluesky Chat network.
        </text>
        <view className="mode-selector-row">
          {(["all", "following", "none"] as const).map((mode) => (
            <text
              key={mode}
              className={(chatDeclaration ?? "following") === mode ? "mode-tab active" : "mode-tab"}
              bindtap={() => onUpdateChatDeclaration?.(mode)}
            >
              {mode === "all" ? "EVERYONE (ALL)" : mode === "following" ? "FOLLOWERS ONLY" : "NOBODY (NONE)"}
            </text>
          ))}
        </view>
      </view>

      {/* HOMEPAGE EXPERIENCE */}
      <view className="settings-card">
        <text className="section-title">// HOMEPAGE LANDING EXPERIENCE</text>
        <text className="copy-sm">
          Choose your primary view when navigating to netslum.macha.sh.
          "Personal Dashboard" displays your custom widgets, followed feeds, and WebMCP-authored layout.
          "World View" displays the original Chaos Gate sector portal and town stream.
        </text>
        <view className="mode-selector-row">
          <text
            className={selectedHomeMode === "standard" ? "mode-tab active" : "mode-tab"}
            bindtap={() => setSelectedHomeMode("standard")}
          >
            PERSONAL DASHBOARD (CUSTOM)
          </text>
          <text
            className={selectedHomeMode === "authored" ? "mode-tab active" : "mode-tab"}
            bindtap={() => setSelectedHomeMode("authored")}
          >
            WORLD VIEW (SYSTEM DEFAULT)
          </text>
        </view>

        <view className="setting-actions">
          {onSaveHomeSettings ? (
            <text
              className="primary-sm"
              style="cursor:pointer;"
              bindtap={() => onSaveHomeSettings(selectedHomeMode, selectedHomeMode === "authored" ? "index.html" : null)}
            >
              SAVE HOMEPAGE PREFERENCE
            </text>
          ) : null}
        </view>
      </view>

      {/* SESSION & OAUTH CAPABILITIES */}
      <view className="settings-card">
        <text className="section-title">// OAUTH SESSION CAPABILITIES</text>
        <view className="capability-list">
          <view className="capability-row">
            <text className="cap-label">DID</text>
            <text className="cap-value">{did ?? "unknown"}</text>
          </view>
          <view className="capability-row">
            <text className="cap-label">Handle</text>
            <text className="cap-value">@{handle ?? "unknown"}</text>
          </view>
          <view className="capability-row">
            <text className="cap-label">OAuth Scope Version</text>
            <text className="cap-value">v{scopeVersion ?? 1}</text>
          </view>
          <view className="capability-row">
            <text className="cap-label">Site Publishing Granted</text>
            <text className={canPublishSite ? "cap-value green" : "cap-value muted"}>
              {canPublishSite ? "YES" : "NO (External PDS)"}
            </text>
          </view>
          <view className="capability-row">
            <text className="cap-label">Direct Messages Granted</text>
            <text className={canUseDms ? "cap-value green" : "cap-value muted"}>
              {canUseDms ? "YES" : "NO"}
            </text>
          </view>
          <view className="capability-row">
            <text className="cap-label">Video Upload RPC Granted</text>
            <text className={canUploadVideo ? "cap-value green" : "cap-value muted"}>
              {canUploadVideo ? "YES" : "NO"}
            </text>
          </view>
        </view>
      </view>

      {/* SIGN OUT */}
      {onLogout ? (
        <view className="action-row">
          <text className="secondary-sm danger" bindtap={onLogout}>
            SIGN OUT OF NETSLUM
          </text>
        </view>
      ) : null}
    </view>
  );
}
