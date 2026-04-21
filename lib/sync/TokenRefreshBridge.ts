// ─── Token Refresh Bridge ─────────────────────────────────────────────────────
//
// Coordinates transparent token refresh across concurrent API requests.
// When multiple requests get 401 simultaneously, only ONE refresh runs;
// all other requests wait for it to complete, then retry with the new token.
//
// Usage:
//   AuthProvider registers: registerTokenRefreshHandler(getToken, refreshToken, setToken)
//   api.ts on 401: await attemptTokenRefresh(currentToken) — returns new token or throws

let _getToken: (() => string | null) | null = null;
let _refreshToken: ((token: string) => Promise<{ token: string }>) | null = null;
let _setToken: ((token: string) => Promise<void>) | null = null;
let _refreshInProgress: Promise<string | null> | null = null;

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
 * Attempt token refresh. If a refresh is already in progress, waits for it.
 * Returns the new token on success, null if refresh failed/skipped.
 * Only triggers refresh when all handlers are registered (backend supports it).
 */
export async function attemptTokenRefresh(currentToken: string): Promise<string | null> {
  if (!isTokenRefreshHandlerRegistered()) return null;

  // If a refresh is already in progress, wait for it
  if (_refreshInProgress) {
    return _refreshInProgress;
  }

  _refreshInProgress = (async () => {
    try {
      const result = await _refreshToken!(currentToken);
      if (result?.token) {
        await _setToken!(result.token);
        return result.token;
      }
      return null;
    } catch {
      return null;
    } finally {
      _refreshInProgress = null;
    }
  })();

  return _refreshInProgress;
}
