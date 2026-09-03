export type { SessionInfo } from "../webmcp.js";


export type LynxDataScalar = string | number | boolean | null | undefined;
export type LynxDataRecord = Record<string, LynxDataScalar | LynxDataScalar[]>;

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  retryable?: boolean;
  data?: { currentRevision?: string; currentVersion?: number };
}

export interface ActionStatus {
  action: "post" | "zone" | "site" | "logout" | "message" | "search" | "profile" | "graph" | "settings";
  state: "busy" | "success" | "error";
  message: string;
  nonce: number;
}

export interface ZonePayload {
  zoneKey: string;
  version: number;
  objects: unknown[];
}

export interface StudioSite {
  slug: string;
  revision: string;
  files: Array<{ path: string }>;
  activeRevision: string | null;
  isStarter: boolean;
}

export interface ActionSheetParams {
  kind: "like-post" | "toggle-follow" | "reply-to-post";
  subjectUri?: string | undefined;
  subjectCid?: string | undefined;
  actorInput?: string | undefined;
  text?: string | undefined;
  origin: string;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiErrorPayload
  ) {
    super(payload.message ?? `Request failed with HTTP ${status}`);
  }
}

export const SESSION_TTL = 30_000;
