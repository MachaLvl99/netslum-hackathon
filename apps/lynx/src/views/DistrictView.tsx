export interface DistrictViewProps {
  slug: string;
  path?: string | undefined;
  title?: string | undefined;
  routeError?: string | undefined;
  navigate: (route: string) => void;
  onExit?: (() => void) | undefined;
}

export function DistrictView(props: DistrictViewProps) {
  const { slug, path = "index.html", title, routeError, navigate, onExit } = props;

  const handleExit = () => {
    if (onExit) onExit();
    else navigate("/zone/hidden.archive.echo");
  };

  if (routeError) {
    return (
      <view className="content">
        <text className="kicker">DISTRICT ERROR</text>
        <text className="title">unable to enter district</text>
        <text className="copy">{routeError}</text>
        <view className="action-row">
          <text className="primary" bindtap={handleExit}>
            RETURN TO CHAOS GATE &rarr;
          </text>
        </view>
      </view>
    );
  }

  return (
    <view className="view-district">
      {/* TRUSTED DISTRICT HEADER (PARENT CONTROLS) */}
      <view className="district-header">
        <view className="district-header-left">
          <text className="district-tag">DISTRICT</text>
          <text className="district-title">@{slug} {title ? `// ${title}` : ""}</text>
          <text className="district-gpu-badge">⚡ WebGPU</text>
        </view>

        <view className="district-header-right">
          <text className="district-exit-btn" bindtap={handleExit}>
            &larr; EXIT TO CHAOS GATE
          </text>
        </view>
      </view>

      {/* DISTRICT SANDBOX FRAME PLACEHOLDER FOR LYNX VIEW */}
      <view className="district-body">
        <text className="district-hint">
          District environment active ({path}). The sandboxed WebGPU canvas runs securely in the host viewport.
        </text>
      </view>
    </view>
  );
}
