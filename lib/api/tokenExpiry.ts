// ─── Token Expiry Bridge ────────────────────────────────────────────────────
//
// Allows lib/api/client.ts (non-React module) to signal the React tree when
// the backend returns 401 (token expired or invalid) without creating a
// circular dependency.
//
// Usage:
//   In AuthProvider: registerTokenExpiryHandler(() => { clear token, prompt re-login });
//   In api client: if (res.status === 401 && refresh fails) triggerTokenExpiry();

type TokenExpiryCallback = () => void;
let _handler: TokenExpiryCallback | null = null;

export function registerTokenExpiryHandler(cb: TokenExpiryCallback): void {
  _handler = cb;
}

export function triggerTokenExpiry(): void {
  _handler?.();
}
