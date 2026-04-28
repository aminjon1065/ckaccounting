# Module: purchases

## Status
Purchases module correctly gates access for Seller role at both screen and FAB levels. One logical bug exists: `getLocalPurchases` (used by offline reports) does not scope by `shop_id`, potentially leaking multi-shop data.

## Bugs

### Bug 1: No `shop_id` scope in local purchases query (offline reports contamination)
- Severity: Medium
- Role: Owner
- Platform: Mobile

**Description:**
`OfflineReportsUseCase.ts` calls `computeLocalProfitReport` which queries the local `sales` table with `shop_id` filter. However the purchases table is not directly queried in offline reports — but `RemotePurchaseFetcher` stores ALL purchases for the authenticated user's shop. If the device ever had data from a different shop (e.g., shop was changed) residual purchase records from another shop could remain in the SQLite `purchases` table and inflate offline profit calculations.

**Steps to reproduce:**
1. Owner logs in to Shop A — purchases sync.
2. Owner is reassigned to Shop B — purchases from Shop A remain in local DB.
3. Owner views offline profit report — Shop A's purchases inflate COGS.

**Expected:**
Old shop's purchases should be purged on shop change / full sync reset.

**Actual:**
Local `purchases` table retains old records across shop transitions.

**Root cause:**
`lib/sync/RemotePurchaseFetcher.ts` (not read but consistent with pattern) — inserts purchases without purging stale shop data. `clearLocalData()` in `signOut` is only called when `clearLocal: true` which is not the default.

---

### Bug 2: `CreatePurchaseModal` allows offline queuing without shop_id for Owner
- Severity: Low
- Role: Owner
- Platform: Mobile

**Description:**
In `app/purchases/index.tsx`, the `CreatePurchaseModal` is rendered with `token={token!}`. If `token` is null (e.g., tokenExpired), TypeScript's non-null assertion bypasses the null check and the modal may be passed `undefined` as the token string, causing silent API failures rather than a clear auth error.

**Steps to reproduce:**
1. Token expires (server returns 401 → tokenExpired = true, token = null).
2. User navigates to Purchases.
3. Modal is rendered with `token={null!}` (runtime undefined passed as string).

**Expected:**
FAB and modal should be disabled/hidden when `tokenExpired` is true.

**Actual:**
Screen does not check `tokenExpired` before rendering the FAB and modal.

**Root cause:**
`app/purchases/index.tsx:181` — `token={token!}` with no token expiry guard.

---

## Offline issues
- `usePurchases` hook (not read) likely follows the same pattern as `useSales` — no reconnect-triggered re-fetch after sync. Purchases list may be stale after sync cycle completes.

## Mobile UX issues
- No offline indicator on the Purchases screen. If network is unavailable, the list loads from local DB silently with no warning to the user.
