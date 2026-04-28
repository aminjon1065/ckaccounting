# Module: dashboard

## Status
Dashboard has a role-visibility gap: Sellers receive financial cost/profit/expense stats from the API but only the mobile UI hides them — the data is still returned in the JSON payload.

## Bugs

### Bug 1: DashboardService returns cost_price / profit data to Seller role — API leaks financial info
- Severity: High
- Role: Seller
- Platform: Mobile / Web

**Description:**
`DashboardController.php` passes the `$sellerId` to `DashboardService::build()` for scoping, but the service's returned data object still contains `period_cogs`, `period_profit`, `period_expenses_total`, `stock_total_cost` fields. These are not stripped from the API response for sellers. A Seller can call `GET /api/v1/dashboard` and receive gross-margin information from the raw JSON.

**Steps to reproduce:**
1. Authenticate as Seller role.
2. `GET /api/v1/dashboard?period=month` with Bearer token.
3. Inspect JSON response — `period_cogs`, `period_profit`, `stock_total_cost` are present with real values.

**Expected:**
Response for Seller should have `period_cogs`, `period_profit`, `stock_total_cost` either omitted or returned as `null`.

**Actual:**
All financial fields are returned. Only the mobile `StatsGrid.tsx` hides them in the UI.

**Root cause:**
`acc-backend/app/Http/Controllers/Api/V1/DashboardController.php:23` — `$sellerId` is passed but used only for sales scoping; the serialised response includes all fields.

---

### Bug 2: `useDashboard` — `isOffline` detection logic is unreliable
- Severity: Medium
- Role: Both
- Platform: Mobile

**Description:**
At `hooks/useDashboard.ts:39`:
```ts
const isOfflineError = err?.status === 0 || !err?.message?.includes("status");
```
The second condition `!err?.message?.includes("status")` is true for ANY error whose message does not contain the word "status", including server-side 5xx errors, malformed JSON, etc. This causes non-network errors to falsely trigger offline cache fallback.

**Steps to reproduce:**
1. Server returns HTTP 500 with message "Internal Server Error".
2. `err.message` does not contain "status" (it says "Internal Server Error").
3. `isOfflineError` evaluates to `true` → app shows stale cache instead of error.

**Expected:**
Only network-unreachable errors (status === 0 or `Network request failed`) should trigger offline fallback.

**Actual:**
Any error without "status" in the message triggers silent fallback to stale cache.

**Root cause:**
`hooks/useDashboard.ts:39` — incorrect guard condition.

---

### Bug 3: `StockInfoCard` and `ZakatCard` display `stock_total_cost` to Seller
- Severity: Medium
- Role: Seller
- Platform: Mobile

**Description:**
`app/(tabs)/index.tsx` renders `StockInfoCard` and `ZakatCard` for all roles (no Seller guard). `StockInfoCard` receives `totalCost={summary.stock_total_cost}` and `ZakatCard` uses it to compute zakat on cost. These expose cost-price-derived financial data to Sellers.

**Steps to reproduce:**
1. Sign in as Seller.
2. Open Dashboard.
3. Scroll to the card section — `StockInfoCard` shows stock cost, `ZakatCard` shows cost-based zakat.

**Expected:**
`StockInfoCard` should hide cost column and `ZakatCard` should not be visible to Sellers.

**Actual:**
Both cards render to Sellers without any guard.

**Root cause:**
`app/(tabs)/index.tsx:191-215` — no `!isSeller` guard wraps `StockInfoCard` or `ZakatCard`.

---

## Offline issues
- Stale cache age is computed but never displayed to the user (the `cacheAge` state is populated but not passed to any UI component).

## Mobile UX issues
- The hide/show toggle (eye icon) persists correctly but the `isDataHidden` state is not propagated to `StockInfoCard`, `ZakatCard`, or `DebtsCard` — these always show numbers even when the hide toggle is active for those individual sub-components. Check component props.
