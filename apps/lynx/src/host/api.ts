import type { ActionStatus, ApiErrorPayload, SessionInfo } from "./types.js";
import { ApiFailure, SESSION_TTL } from "./types.js";
import { state, pushData } from "./state.js";

export function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)__Host-netslum-csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function mutationHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-CSRF-Token": getCsrfToken()
  };
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: "same-origin", ...init });
  const payload = (await response.json().catch(() => null)) as T | ApiErrorPayload | null;
  if (!response.ok) {
    throw new ApiFailure(response.status, (payload ?? {}) as ApiErrorPayload);
  }
  return payload as T;
}

export async function getSession(): Promise<SessionInfo> {
  if (state.cachedSession && Date.now() - state.cachedSession.ts < SESSION_TTL) {
    return state.cachedSession.data;
  }
  const s = await apiJson<SessionInfo>("/api/session");
  state.cachedSession = { data: s, ts: Date.now() };
  return s;
}

export function invalidateSessionCache(): void {
  state.cachedSession = null;
}

export function setStatus(action: ActionStatus["action"], stateKind: ActionStatus["state"], message: string): void {
  const status: ActionStatus = { action, state: stateKind, message, nonce: Date.now() };
  pushData({ actionStatus: JSON.stringify(status) });
}

export function describeFailure(error: unknown): string {
  if (error instanceof ApiFailure) {
    const code = error.payload.code ? `${error.payload.code}: ` : "";
    return `${code}${error.message}`;
  }
  return error instanceof Error ? error.message : "Request failed";
}

/**
 * loadTimelinePage — fetches one page of the signed-in user's followed feed.
 * Returns null when unauthenticated or when the upstream call fails.
 */
export async function loadTimelinePage(limit = 25): Promise<Array<{ uri: string; createdAt: string }> | null> {
  try {
    const session = await getSession();
    if (!session.authenticated) return null;
    const page = await apiJson<{ posts: Array<{ uri: string; createdAt: string }> }>(`/api/timeline?limit=${limit}`);
    return page.posts ?? [];
  } catch {
    return null;
  }
}
