import type { PostItem } from "./types.js";

declare let NativeModules: { NetslumHost: { openUrl(url: string): void; playVideo(playlist: string, thumbnail?: string, alt?: string, key?: string): void } };

type RawEmbed = NonNullable<PostItem["embeds"]>[number];

type ParsedMedia =
  | { kind: "images"; key: string; images: ParsedImage[] }
  | { kind: "video"; key: string; thumbnail?: string | undefined; playlist?: string | undefined; alt: string };

interface ParsedImage {
  key: string;
  src: string;
  alt: string;
}

export interface PostEmbedsProps {
  embeds?: PostItem["embeds"];
}

const IMAGE_VIEW_TYPE = "app.bsky.embed.images#view";
const VIDEO_VIEW_TYPE = "app.bsky.embed.video#view";
const RECORD_WITH_MEDIA_VIEW_TYPES: Record<string, true> = {
  "app.bsky.embed.recordWithMedia#view": true,
  "app.bsky.embed.record_with_media#view": true
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseImageView(view: Record<string, unknown>, embedKey: string): ParsedMedia | undefined {
  if (!Array.isArray(view.images)) return undefined;

  const images: ParsedImage[] = [];
  for (let index = 0; index < view.images.length; index += 1) {
    const image: unknown = view.images[index];
    if (!isRecord(image)) continue;

    const thumb = nonEmptyString(image.thumb);
    const fullsize = nonEmptyString(image.fullsize);
    const src = thumb ?? fullsize;
    if (!src) continue;

    images.push({
      key: `${embedKey}-image-${index}`,
      src,
      alt: typeof image.alt === "string" ? image.alt : ""
    });
  }

  return images.length > 0 ? { kind: "images", key: embedKey, images } : undefined;
}

function parseVideoView(view: Record<string, unknown>, embedKey: string): ParsedMedia | undefined {
  const thumbnail = nonEmptyString(view.thumbnail);
  const playlist = nonEmptyString(view.playlist);
  if (!thumbnail && !playlist) return undefined;

  return {
    kind: "video",
    key: embedKey,
    ...(thumbnail ? { thumbnail } : {}),
    ...(playlist ? { playlist } : {}),
    alt: typeof view.alt === "string" ? view.alt : ""
  };
}

function parseMediaView(value: unknown, embedKey: string): ParsedMedia | undefined {
  const view = value;
  if (!isRecord(view)) return undefined;

  const type = nonEmptyString(view.$type);
  if (type === IMAGE_VIEW_TYPE) return parseImageView(view, embedKey);
  if (type === VIDEO_VIEW_TYPE) return parseVideoView(view, embedKey);
  if (type && RECORD_WITH_MEDIA_VIEW_TYPES[type] === true) {
    return parseMediaView(view.media, `${embedKey}-media`);
  }
  return undefined;
}

function parseEmbeds(embeds: readonly RawEmbed[]): ParsedMedia[] {
  const parsed: ParsedMedia[] = [];
  for (let index = 0; index < embeds.length; index += 1) {
    const media = parseMediaView(embeds[index], `embed-${index}`);
    if (media) parsed.push(media);
  }
  return parsed;
}

export function PostEmbeds({ embeds }: PostEmbedsProps) {
  if (!embeds || embeds.length === 0) return null;

  const media = parseEmbeds(embeds);
  if (media.length === 0) return null;

  return (
    <view className="post-embeds">
      {media.map((entry) => entry.kind === "images" ? (
        <view key={entry.key} className={entry.images.length === 1 ? "post-embed-grid single" : "post-embed-grid multi"}>
          {entry.images.map((image) => (
            <view key={image.key} className="post-embed-image-tile">
              <image
                className="post-embed-image"
                src={image.src}
                mode="aspectFill"
                accessibility-element={true}
                accessibility-traits="image"
                accessibility-label={image.alt || "Post image without alternative text"}
              />
            </view>
          ))}
        </view>
      ) : (
        <view key={entry.key} className="post-video-embed" data-video-key={entry.key} catchtap={() => { if (entry.playlist) try { NativeModules.NetslumHost.playVideo(entry.playlist, entry.thumbnail, entry.alt, entry.key); } catch { /* native call */ } }}>
          <view className="post-video-visual">
            {entry.thumbnail ? (
              <image
                className="post-video-thumbnail"
                src={entry.thumbnail}
                mode="aspectFill"
                accessibility-element={true}
                accessibility-traits="image"
                accessibility-label={entry.alt || "Video thumbnail without alternative text"}
              />
            ) : (
              <view className="post-video-thumbnail-placeholder" />
            )}
            <view className="post-video-overlay" accessibility-elements-hidden={true}>
              <text className="post-video-play-icon">▶</text>
              <text className="post-video-play-label">PLAY VIDEO</text>
            </view>
          </view>
          {entry.alt ? <text className="post-video-alt">ALT // {entry.alt}</text> : null}
        </view>
      ))}
    </view>
  );
}
