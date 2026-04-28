# Module: expenses

## Status
Expenses module correctly blocks Seller access at the screen level. No critical bugs found, but two medium issues exist around token safety and offline scoping.

## Bugs

### Bug 1: `token!` non-null assertion on `ExpenseFormModal` without expiry guard
- Severity: Medium
- Role: Owner
- Platform: Mobile

**Description:**
`app/expenses.tsx:143` renders `<ExpenseFormModal ... token={token!} />`. If `token` is null (expired, not yet loaded), the `!` assertion passes `undefined` as the token string to the modal, which will then make unauthenticated API calls that fail silently instead of redirecting to login.

**Steps to reproduce:**
1. Token expires while Expenses screen is open.
2. Edit button is tapped → form modal opens.
3. Save is attempted — API call made with undefined token → 401 → silent error or infinite retry.

**Expected:**
Form modal should not render when `token` is null or `tokenExpired`.

**Actual:**
`app/expenses.tsx:143` — `token={token!}` always passes a value.

**Root cause:**
`app/expenses.tsx:143` — no null/expiry guard before `token={token!}`.

---

### Bug 2: Offline expense report includes ALL shop expenses even after shop reassignment
- Severity: Low
- Role: Owner
- Platform: Mobile

**Description:**
`computeLocalExpensesReport` in `OfflineReportsUseCase.ts` already has a `shop_id` filter (line 126-129). However, the local `expenses` table may contain stale records from a previous shop if the user was reassigned and no purge was triggered. Same root cause as Bug 1 in purchases module.

**Steps to reproduce:**
1. Owner in Shop A syncs expenses.
2. Owner reassigned to Shop B.
3. No full sync purge triggers.
4. Offline expense report shows combined Shop A + Shop B data.

**Expected:**
Only current shop's expenses in offline report.

**Actual:**
Old shop data persists in local `expenses` table.

**Root cause:**
`lib/sync/RemoteExpenseFetcher.ts` — no purge of stale shop data on full sync.

---

## Offline issues
- Expenses are synced via `RemoteExpenseFetcher` only for Owner/admin (Seller is excluded in `SyncOrchestrator`). If a Seller somehow navigates to `/expenses` (route is not protected by Expo Router), they would see an access-denied screen rather than crashing — this is correct behavior.

## Mobile UX issues
- No confirmation dialog before deleting an expense. Tap on delete → immediate deletion without undo.
