// ─── Token Refresh Bridge ─────────────────────────────────────────────────────
//
// Coordinates transparent token refresh across concurrent API requests with
// two correctness properties layered on top of a simple "single-flight" cache:
//
//   1. Single-flight: when N parallel requests get 401 simultaneously, only
//      ONE refresh actually goes to the network; the other N-1 attach to its
//      promise and pick up the new token.
//
//   2. Circuit breaker: if refresh fails repeatedly within a short window,
//      stop trying and force-expire the session — bombing the refresh
//      endpoint in a tight loop on a degraded backend would amplify the
//      outage. After MAX_REFRESH_FAILURES failures inside FAILURE_WINDOW_MS,
//      `triggerTokenExpiry()` fires once and subsequent calls short-circuit
//      to `null` until `resetTokenRefreshState()` is called (typically on a
//      fresh sign-in).
//
// The bridge is the single source of truth for "this token is dead." API
// callsites should NOT speculatively trigger expiry on raw 401s — the bridge
// will do so iff refresh genuinely cannot recover. This avoids the UI
// mistakenly bouncing the user to /login while a refresh is mid-flight.

import { triggerTokenExpiry } from "./tokenExpiry";
import { reportError, reportMessage } from "@/lib/observability/reporter";

let _getToken: (() => string | null) | null = null;
let _refreshToken: ((token: string) => Promise<{ token: string }>) | null = null;
let _setToken: ((token: string) => Promise<void>) | null = null;
let _refreshInProgress: Promise<string | null> | null = null;

// Circuit breaker state. Failures inside a sliding window count toward
// tripping; isolated failures separated by more than FAILURE_WINDOW_MS reset
// the counter. Three failures in five minutes is generous enough to absorb
// brief network blips but tight enough to detect a token-revoked-server-side
// situation quickly.
const MAX_REFRESH_FAILURES = 3;
const FAILURE_WINDOW_MS = 5 * 60_000;
let _failureCount = 0;
let _lastFailureAt = 0;
let _circuitTripped = false;
// One-shot latch: triggerTokenExpiry should fire exactly once per terminal
// failure event, not on every subsequent attemptTokenRefresh call.
let _expiryFired = false;

export function registerTokenRefreshHandler(opts: {
  getToken: () => string | null;
  refreshToken: (token: string) => Promise<{ token: string }>;
  setToken: (token: string) => Promise<void>;
}): void {
  _getToken = opts.getToken;
  _refreshToken = opts.refreshToken;
  _setToken = opts.setToken;
}

export function isTokenRefreshHandlerRegistered(): boolean {
  return _getToken !== null && _refreshToken !== null && _setToken !== null;
}

/**
 * Reset the bridge's transient state. Call on any fresh authentication
 * boundary (login, offline-login, password-relogin, logout) so a previous
 * session's failure history doesn't poison the new session's circuit.
 */
export function resetTokenRefreshState(): void {
  _failureCount = 0;
  _lastFailureAt = 0;
  _circuitTripped = false;
  _expiryFired = false;
  _refreshInProgress = null;
}

/**
 * Attempt token refresh. Returns the new token on success, or `null` if
 * refresh failed, was skipped (handler not registered), or the circuit is
 * tripped.
 *
 * Concurrent callers attach to a single in-flight refresh — never multiple.
 *
 * On terminal failure (circuit trip OR handler-not-registered) the bridge
 * fires `triggerTokenExpiry()` exactly once, propagating the "session must
 * end" signal to the React tree. Until `resetTokenRefreshState()` is
 * called, further calls return `null` immediately.
 */
export async function attemptTokenRefresh(currentToken: string): Promise<string | null> {
  if (!isTokenRefreshHandlerRegistered()) {
    // No refresh transport configured. The 401 is unrecoverable from the
    // bridge's perspective; force expiry so the UI can prompt for re-login.
    fireExpiryOnce();
    return null;
  }

  if (_circuitTripped) {
    return null;
  }

  if (_refreshInProgress) {
    return _refreshInProgress;
  }

  _refreshInProgress = (async () => {
    try {
      const result = await _refreshToken!(currentToken);
      if (result?.token) {
        await _setToken!(result.token);
        recordSuccess();
        return result.token;
      }
      recordFailure();
      return null;
    } catch (e) {
      // 401 from the refresh endpoint is authoritative: the server has
      // explicitly rejected this token. Don't wait for the failure-window
      // counter — trip the circuit immediately and force re-login.
      // Duck-type on `status` to avoid a circular import on ApiError.
      if (typeof (e as { status?: unknown })?.status === "number" && (e as { status: number }).status === 401) {
        reportMessage(
          "Token refresh returned 401 — token is dead, forcing re-login",
          "warning",
          { tag: "token-refresh-unauthorized" }
        );
        _circuitTripped = true;
        fireExpiryOnce();
        return null;
      }
      reportError(e, { tag: "token-refresh", failureCount: _failureCount + 1 });
      recordFailure();
      return null;
    } finally {
      _refreshInProgress = null;
    }
  })();

  return _refreshInProgress;
}

function recordSuccess(): void {
  _failureCount = 0;
  _lastFailureAt = 0;
  _circuitTripped = false;
  _expiryFired = false;
}

function recordFailure(): void {
  const now = Date.now();
  if (now - _lastFailureAt > FAILURE_WINDOW_MS) {
    _failureCount = 1;
  } else {
    _failureCount += 1;
  }
  _lastFailureAt = now;

  if (_failureCount >= MAX_REFRESH_FAILURES) {
    _circuitTripped = true;
    fireExpiryOnce();
  }
}

function fireExpiryOnce(): void {
  if (_expiryFired) return;
  _expiryFired = true;
  reportMessage(
    `Token refresh bridge tripping circuit after ${_failureCount} failures; forcing re-login`,
    "warning",
    { tag: "token-refresh-circuit", failureCount: _failureCount }
  );
  triggerTokenExpiry();
}
