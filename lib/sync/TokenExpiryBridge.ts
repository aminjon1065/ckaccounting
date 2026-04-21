// ─── Token Expiry Bridge ────────────────────────────────────────────────────────
//
// Allows lib/api.ts (non-React module) to signal the React tree when the
// backend returns 401 (token expired or invalid) without creating a circular
// dependency.
//
// Usage:
//   In AuthProvider: registerTokenExpiryHandler(() => { clear token, prompt re-login });
//   In api.ts request(): if (res.status === 401) triggerTokenExpiry();

type TokenExpiryCallback = () => void;
let _handler: TokenExpiryCallback | null = null;

export function registerTokenExpiryHandler(cb: TokenExpiryCallback): void {
  _handler = cb;
}

export function triggerTokenExpiry(): void {
  _handler?.();
}
