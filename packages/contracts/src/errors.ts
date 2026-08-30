export const errorCodes = [
  "AUTH_REQUIRED", "FORBIDDEN", "LOCAL_PDS_REQUIRED", "INVALID_HANDLE", "INVALID_INPUT",
  "NOT_FOUND", "STALE_REVISION", "CONFLICT", "ZONE_FULL", "RATE_LIMITED",
  "PUBLISH_IN_PROGRESS", "RECORD_CONFLICT", "SERVERLESS_UNAVAILABLE",
  "UPSTREAM_UNAVAILABLE", "WORKER_FAILED"
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class NetslumError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly data?: { currentRevision?: string; currentVersion?: number }
  ) {
    super(message);
    this.name = "NetslumError";
  }
}

export type ToolResult<T> =
  | { ok: true; action: string; url: string; data: T }
  | { ok: false; action: string; url: string; error: { code: string; message: string; retryable: boolean }; data?: { currentRevision?: string; currentVersion?: number } };
