export interface InitData {
  route?: string;
  authenticated?: boolean;
  did?: string;
  handle?: string;
  canPublishSite?: boolean;
  feed?: string;
  zone?: string;
  site?: string;
  profile?: string;
  actionStatus?: string;
  routeError?: string;
  feedStale?: boolean;
  compactViewport?: boolean;
  lastUpdatedAt?: number;
  editorChunk?: string;
  editorRevision?: string;
}

export interface PostItem {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName?: string };
  text: string;
  createdAt: string;
}

export interface ZoneObjectItem {
  id: string;
  type: string;
  x: number;
  y: number;
  text?: string;
  shape?: string;
  color?: string;
  targetZoneKey?: string;
}

export interface LynxInputEvent {
  detail: { value: string };
}

export interface ActionStatus {
  action: "post" | "zone" | "site" | "logout";
  state: "busy" | "success" | "error";
  message: string;
  nonce: number;
}

export interface SiteFileInfo {
  path: string;
  size: number;
}

export interface ProfileInfo {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  siteUrl?: string | null;
}

export const FEATURED_ZONES = [
  "hidden.archive.echo",
  "burning.market.static",
  "silent.garden.rain",
  "wandering.harbor.dream",
  "broken.labyrinth.void",
  "electric.cathedral.dawn"
] as const;