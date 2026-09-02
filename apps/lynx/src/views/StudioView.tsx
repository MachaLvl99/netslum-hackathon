import type { LynxInputEvent, SiteFileInfo } from "./types.js";

export const EDITOR_CHUNK_CHARS = 1000;

export interface StudioViewProps {
  siteSlug: string;
  siteRevision: string;
  routeError: string | undefined;
  siteFiles: SiteFileInfo[];
  editorPath: string;
  editorText: string;
  setEditorText: (value: string) => void;
  editorNextOffset: number;
  loadMoreEditor: () => void;
  openFile: (path: string) => void;
  siteBusy: boolean;
  saveFile: () => void;
  publishSite: () => void;
  sitePublishedUrl: string;
}

export function StudioView(props: StudioViewProps) {
  const {
    siteSlug,
    siteRevision,
    routeError,
    siteFiles,
    editorPath,
    editorText,
    setEditorText,
    editorNextOffset,
    loadMoreEditor,
    openFile,
    siteBusy,
    saveFile,
    publishSite,
    sitePublishedUrl
  } = props;
  return (
    <view className="content">
      <text className="kicker">PERSONAL SITE STUDIO // @{siteSlug || "loading"}</text>
      <text className="title">programmable page editor</text>
      <text className="copy">Draft Revision: {siteRevision.slice(0, 16) || "none"}</text>
      {routeError ? <text className="stale-label">{routeError}</text> : null}

      <view className="studio-container">
        <view className="file-tree">
          <text className="tree-header">FILES ({siteFiles.length})</text>
          {siteFiles.map(f => (
            <view key={f.path} className={editorPath === f.path ? "file-item file-item-active" : "file-item"} bindtap={() => openFile(f.path)}>
              <text className="file-item-text">&bull; {f.path}</text>
              <text className="file-item-size">{f.size} B</text>
            </view>
          ))}
        </view>

        <view className="editor-panel">
          <text className="editor-label">EDITING {editorPath || "index.html"}</text>
          <input
            className="editor-input"
            placeholder="<h1>Welcome to my Net Slum site</h1>"
            value={editorText}
            bindinput={(e: LynxInputEvent) => setEditorText(e.detail.value)}
          />
          {editorNextOffset ? (
            <text className="stale-label" bindtap={loadMoreEditor}>FILE TRUNCATED // TAP TO LOAD NEXT {EDITOR_CHUNK_CHARS} CHARS</text>
          ) : null}
          <view className="editor-actions">
            <text className={siteBusy ? "primary-sm busy" : "primary-sm"} bindtap={saveFile}>SAVE DRAFT</text>
            <text className="secondary-sm" bindtap={publishSite}>PUBLISH SITE LIVE</text>
          </view>
          {sitePublishedUrl ? (
            <text className="stale-label">PUBLISHED // {sitePublishedUrl}</text>
          ) : null}
        </view>
      </view>
    </view>
  );
}