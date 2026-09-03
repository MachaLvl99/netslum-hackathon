import { view } from "./state.js";

// HLS.js loader — loaded once on first video play, reused thereafter.
export type HlsInstance = {
  loadSource(url: string): void;
  attachMedia(el: HTMLVideoElement): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  destroy(): void;
};

export type HlsStatic = {
  isSupported(): boolean;
  new (config?: object): HlsInstance;
  readonly Events: Record<string, string>;
};

let hlsReady: Promise<HlsStatic | null> | undefined;

export function ensureHls(): Promise<HlsStatic | null> {
  if (hlsReady) return hlsReady;
  hlsReady = new Promise<HlsStatic | null>((resolve) => {
    const win = window as unknown as { Hls?: HlsStatic };
    if (win.Hls) {
      resolve(win.Hls);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
    script.onload = () => {
      resolve(win.Hls ?? null);
    };
    script.onerror = () => {
      hlsReady = undefined;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return hlsReady;
}
export function handlePlayVideo(input: {
  playlist?: string | undefined;
  thumbnail?: string | undefined;
  alt?: string | undefined;
  key?: string | undefined;
}): void {
  const playlistUrl = input.playlist;
  if (!playlistUrl || !playlistUrl.startsWith("https://")) return;

  // Clean up any previous inline player (check both main DOM and shadow).
  let prevPlayer: Element | null = null;
  for (const root of [document, view.shadowRoot]) {
    const prev = root?.querySelector(".netslum-inline-video") ?? null;
    if (prev) prevPlayer = prev;
  }
  if (prevPlayer) {
    if (prevPlayer.getAttribute("data-playlist") === playlistUrl) return;
    const prevVideo = prevPlayer.querySelector("video");
    if (prevVideo) {
      prevVideo.pause();
      prevVideo.src = "";
    }
    prevPlayer.remove();
  }

  // Find target embed card in shadow DOM or main DOM
  let embedCard: Element | null = null;
  if (input.key) {
    for (const root of [view.shadowRoot, document]) {
      const el = root?.querySelector(`[data-video-key="${CSS.escape(input.key)}"]`);
      if (el) {
        embedCard = el;
        break;
      }
    }
  }

  const container = document.createElement("div");
  container.className = "netslum-inline-video";
  container.setAttribute("data-playlist", playlistUrl);
  container.style.cssText =
    "position:relative;width:100%;max-width:560px;aspect-ratio:16/9;background:#070910;border-radius:6px;overflow:hidden;margin:8px 0;border:1px solid #1f293d;";

  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.autoplay = true;
  if (input.thumbnail) video.poster = input.thumbnail;
  video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block;";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close video");
  closeBtn.style.cssText =
    "position:absolute;top:6px;right:6px;z-index:2;background:rgba(7,9,16,0.85);color:#8792aa;border:1px solid #2a3652;border-radius:4px;width:24px;height:24px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;";

  let hlsInstance: HlsInstance | null = null;
  const cleanup = () => {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    video.pause();
    video.src = "";
    container.remove();
  };
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    cleanup();
  };

  container.append(video, closeBtn);

  if (embedCard && embedCard.parentElement) {
    embedCard.parentElement.insertBefore(container, embedCard.nextSibling);
  } else {
    container.style.cssText =
      "position:fixed;bottom:16px;right:16px;width:360px;aspect-ratio:16/9;z-index:10000;box-shadow:0 8px 32px rgba(0,0,0,0.7);background:#070910;border:1px solid #57E6FF;border-radius:8px;overflow:hidden;";
    document.body.append(container);
  }

  // Native HLS (Safari/iOS) vs Hls.js fallback
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = playlistUrl;
    void video.play().catch(() => undefined);
  } else {
    void ensureHls().then((Hls) => {
      if (Hls && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsInstance = hls;
        hls.loadSource(playlistUrl);
        hls.attachMedia(video);
        hls.on("hlsManifestParsed", () => {
          void video.play().catch(() => undefined);
        });
      } else {
        cleanup();
        window.open(playlistUrl, "_blank", "noopener,noreferrer");
      }
    });
  }
}
