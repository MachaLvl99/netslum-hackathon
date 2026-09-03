import { useState } from "@lynx-js/react";
import type { PostItem, ProfileInfo } from "./types.js";
import { PostEmbeds } from "./PostEmbeds.js";
import { DynamicPageRenderer, type DynamicPageSchema } from "../pages/renderer.jsx";
declare let NativeModules: { NetslumHost: { uploadAvatar(): void } };
export interface ProfileViewProps {
  profile: ProfileInfo | null;
  viewerDid?: string | undefined;
  authorPosts?: PostItem[] | undefined;
  publicPageSchema?: string | undefined;
  routeError?: string | undefined;
  navigate: (route: string) => void;
  onFollow?: ((actor: string, follow: boolean) => void) | undefined;
  onMute?: ((actor: string, mute: boolean) => void) | undefined;
  onBlock?: ((actor: string, block: boolean) => void) | undefined;
  onSaveProfile?: ((input: { displayName?: string | undefined; description?: string | undefined; swapRecord?: string | undefined }) => void) | undefined;
  savingProfile?: boolean | undefined;
}

export function ProfileView(props: ProfileViewProps) {
  const {
    profile,
    viewerDid,
    authorPosts = [],
    publicPageSchema,
    routeError,
    navigate,
    onFollow,
    onMute,
    onBlock,
    onSaveProfile,
    savingProfile = false
  } = props;

  let customLayout: DynamicPageSchema | null = null;
  if (publicPageSchema) {
    try {
      const parsed = JSON.parse(publicPageSchema) as Record<string, unknown>;
      if (parsed && (("type" in parsed && typeof parsed.type === "string") || ("root" in parsed && typeof parsed.root === "object"))) {
        customLayout = parsed as unknown as DynamicPageSchema;
      }
    } catch {
      customLayout = null;
    }
  }
  const isOwnProfile = Boolean(profile && viewerDid && profile.did === viewerDid);

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");

  const handleSave = () => {
    if (!onSaveProfile || !profile) return;
    onSaveProfile({
      displayName: displayName.trim() || undefined,
      description: description.trim() || undefined
    });
    setEditing(false);
  };

  const isFollowing = Boolean(profile?.viewer?.following);
  const isMuted = Boolean(profile?.viewer?.muted);
  const isBlocking = Boolean(profile?.viewer?.blocking);

  return (
    <view className="content">
      <text className="kicker">AT PROTOCOL IDENTITY</text>

      {profile ? (
        <view className="profile-container">
          <view className="profile-card">
            {profile.banner ? (
              <view className="profile-banner-container">
                <image className="profile-banner" src={profile.banner} mode="aspectFill" />
              </view>
            ) : null}

            <view className="profile-header-row">
              {profile.avatar ? (
                <image className="profile-avatar" src={profile.avatar} mode="aspectFill" />
              ) : (
                <view className="profile-avatar-placeholder">
                  <text className="avatar-letter">{(profile.displayName || profile.handle)[0]?.toUpperCase()}</text>
                </view>
              )}

              <view className="profile-titles">
                <text className="title">@{profile.handle}</text>
                {profile.displayName ? <text className="profile-name">{profile.displayName}</text> : null}
              </view>
            </view>

            {profile.description ? <text className="profile-desc">{profile.description}</text> : null}

            <view className="profile-stats">
              {profile.followersCount !== undefined ? (
                <text className="stat-item"><text className="stat-num">{profile.followersCount}</text> followers</text>
              ) : null}
              {profile.followsCount !== undefined ? (
                <text className="stat-item"><text className="stat-num">{profile.followsCount}</text> following</text>
              ) : null}
              {profile.postsCount !== undefined ? (
                <text className="stat-item"><text className="stat-num">{profile.postsCount}</text> posts</text>
              ) : null}
            </view>

            <text className="profile-did">did: {profile.did}</text>

            {profile.siteUrl ? (
              <text className="primary" bindtap={() => navigate(profile.siteUrl ?? "")}>
                VISIT NETSLUM PAGE {profile.siteUrl} &rarr;
              </text>
            ) : (
              <text className="profile-desc">No published netslum page.</text>
            )}

            {/* VIEWER ACTIONS */}
            {!isOwnProfile && viewerDid ? (
              <view className="profile-actions-row">
                {onFollow ? (
                  <text
                    className={isFollowing ? "secondary-sm active" : "primary-sm"}
                    bindtap={() => onFollow(profile.did, !isFollowing)}
                  >
                    {isFollowing ? "FOLLOWING" : "FOLLOW"}
                  </text>
                ) : null}
                {onMute ? (
                  <text
                    className="secondary-sm"
                    bindtap={() => onMute(profile.did, !isMuted)}
                  >
                    {isMuted ? "UNMUTE" : "MUTE"}
                  </text>
                ) : null}
                {onBlock ? (
                  <text
                    className="secondary-sm danger"
                    bindtap={() => onBlock(profile.did, !isBlocking)}
                  >
                    {isBlocking ? "UNBLOCK" : "BLOCK"}
                  </text>
                ) : null}
                <text
                  className="secondary-sm"
                  bindtap={() => navigate(`/messages?compose=${encodeURIComponent(profile.handle || profile.did)}`)}
                >
                  MESSAGE
                </text>
              </view>
            ) : null}

            {/* OWN PROFILE EDIT TOGGLE */}
            {isOwnProfile ? (
              <view className="profile-owner-actions">
                <text
                  className="secondary-sm"
                  bindtap={() => {
                    setDisplayName(profile.displayName ?? "");
                    setDescription(profile.description ?? "");
                    setEditing(!editing);
                  }}
                >
                  {editing ? "CANCEL EDIT" : "EDIT PROFILE"}
                </text>
              </view>
            ) : null}
          </view>

          {/* PROFILE EDIT FORM */}
          {isOwnProfile && editing ? (
            <view className="profile-edit-card">
              <text className="section-title">// EDIT PROFILE DETAILS</text>

              <text className="input-label">Display Name</text>
              <input
                className="form-input"
                placeholder="Cyber Traveler"
                default-value={displayName}
                bindinput={(e) => setDisplayName(e.detail.value)}
              />

              <text className="input-label">Bio / Description</text>
              <input
                className="form-input"
                placeholder="Traversing Chaos Gate sectors..."
                default-value={description}
                bindinput={(e) => setDescription(e.detail.value)}
              />

              <text className="primary-sm" style="padding:5px 12px;font-size:11px;cursor:pointer;" bindtap={() => { try { NativeModules.NetslumHost.uploadAvatar(); } catch { /* native call */ } }}>UPLOAD AVATAR</text>

              <view className="form-actions">
                <text
                  className={savingProfile ? "primary-sm busy" : "primary-sm"}
                  bindtap={handleSave}
                >
                  {savingProfile ? "SAVING…" : "SAVE PROFILE"}
                </text>
              </view>
            </view>
          ) : null}
          {/* CUSTOM PUBLIC PAGE SCHEMA */}
          {customLayout ? (
            <view className="profile-custom-layout" style="margin-bottom:16px;width:100%;">
              <DynamicPageRenderer schema={customLayout} onNavigate={navigate} />
            </view>
          ) : null}

          {/* AUTHOR POSTS */}
          {authorPosts.length > 0 ? (
            <view className="author-posts-section">
              <text className="section-title">// POSTS BY @{profile.handle}</text>
              <view className="feed-list">
                {authorPosts.map((p) => (
                  <view
                    key={p.uri}
                    className="post-card"
                    bindtap={() => navigate(`/post/${encodeURIComponent(p.uri)}`)}
                  >
                    <view className="post-header">
                      <text className="post-author">@{p.author.handle}</text>
                      <text className="post-time">{new Date(p.createdAt).toLocaleDateString()}</text>
                    </view>
                    <text className="post-text">{p.text}</text>
                    <PostEmbeds embeds={p.embeds} />
                  </view>
                ))}
              </view>
            </view>
          ) : null}
        </view>
      ) : (
        <text className="copy">{routeError || "Resolving identity…"}</text>
      )}
    </view>
  );
}
