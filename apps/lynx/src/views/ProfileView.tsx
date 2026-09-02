import type { ProfileInfo } from "./types.js";

export interface ProfileViewProps {
  profile: ProfileInfo | null;
  routeError: string | undefined;
  navigate: (route: string) => void;
}

export function ProfileView({ profile, routeError, navigate }: ProfileViewProps) {
  return (
    <view className="content">
      <text className="kicker">AT PROTOCOL IDENTITY</text>
      {profile ? (
        <view className="profile-card">
          <text className="title">@{profile.handle}</text>
          {profile.displayName ? <text className="profile-name">{profile.displayName}</text> : null}
          {profile.description ? <text className="profile-desc">{profile.description}</text> : null}
          <text className="profile-did">did: {profile.did}</text>
          {profile.siteUrl ? (
            <text className="primary" bindtap={() => navigate(profile.siteUrl ?? "")}>
              VISIT NETSLUM PAGE {profile.siteUrl} &rarr;
            </text>
          ) : (
            <text className="profile-desc">No published netslum page.</text>
          )}
        </view>
      ) : (
        <text className="copy">{routeError || "Resolving identity…"}</text>
      )}
    </view>
  );
}