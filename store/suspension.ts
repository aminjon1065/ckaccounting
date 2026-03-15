// ─── Shop Suspension Bridge ───────────────────────────────────────────────────
//
// Allows lib/api.ts (non-React module) to signal the React tree when the
// backend returns 403 (shop is suspended) without creating a circular
// dependency.
//
// Usage:
//   In AuthProvider: registerSuspensionHandler(() => setShopSuspended(true));
//   In api.ts request(): if (res.status === 403) triggerSuspension();

type SuspensionCallback = () => void;
let _handler: SuspensionCallback | null = null;

export function registerSuspensionHandler(cb: SuspensionCallback): void {
  _handler = cb;
}

export function triggerSuspension(): void {
  _handler?.();
}
