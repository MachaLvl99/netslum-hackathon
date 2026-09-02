import { FEATURED_ZONES } from "./types.js";

export interface HomeViewProps {
  authenticated: boolean;
  navigate: (route: string) => void;
}

export function HomeView({ authenticated, navigate }: HomeViewProps) {
  return (
    <view className="content">
      <text className="kicker">AGENT-FIRST // AT PROTOCOL SOCIAL SPACE</text>
      <text className="title">the network remembers what we make together</text>
      <text className="copy">
        A federated cyber-commons inspired by .hack Net Slum. Humans guide Codex desktop agents through WebMCP tools,
        traverse Chaos Gate sectors, and publish programmable personal pages powered by Tranquil PDS.
      </text>
      <view className="action-row">
        <text
          className="primary"
          accessibility-label={authenticated ? "enter town square" : "sign in with AT Protocol"}
          bindtap={() => navigate(authenticated ? "/town" : "/oauth/login")}
        >
          {authenticated ? "ENTER TOWN SQUARE &rarr;" : "SIGN IN WITH AT PROTOCOL"}
        </text>
      </view>
      <view className="featured-section">
        <text className="section-title">// ACTIVE CHAOS GATE SECTORS</text>
        <view className="portal-grid">
          {FEATURED_ZONES.map((z) => (
            <view key={z} className="portal-card" bindtap={() => navigate(`/zone/${z}`)}>
              <text className="portal-name">&Delta; {z}</text>
              <text className="portal-desc">Warp directly into sector</text>
            </view>
          ))}
        </view>
      </view>
    </view>
  );
}