# Module: reports

## Status
Reports module is correctly gated for Seller at the screen level. However the offline profit report has a performance and correctness issue (N+1 query per sale item), and the reports screen fires API calls even when `reports:view` permission check is pending.

## Bugs

### Bug 1: Offline profit report has N+1 query problem — O(sales × items) DB calls
- Severity: Medium
- Role: Owner
- Platform: Mobile

**Description:**
`computeLocalProfitReport` in `OfflineReportsUseCase.ts` at lines 195-216 iterates over each filtered sale, then for each sale runs `db.getAllAsync` to get sale items, then for EACH item runs `db.getFirstAsync` to get the product's `cost_price`. With 100 sales averaging 3 items each, this results in 100 + 300 = 400 sequential SQLite queries inside the `await Promise.all` context. On a device with a large sales history, this causes significant lag.

**Steps to reproduce:**
1. Create 50+ offline sales with 2+ items each.
2. Go offline, open Reports → Profit tab.
3. Loading takes several seconds / may timeout on low-end device.

**Expected:**
Report computation should use a JOIN or batch query instead of per-row selects.

**Actual:**
`lib/sync/usecases/OfflineReportsUseCase.ts:195-216` — nested `await db.getFirstAsync` inside item loop inside sale loop.

**Root cause:**
`lib/sync/usecases/OfflineReportsUseCase.ts:206-213` — per-item `getFirstAsync` for product cost_price.

---

### Bug 2: Reports screen calls `loadReport()` before `can(user?.role, "reports:view")` is checked — brief flash of API call for Seller
- Severity: Low
- Role: Seller
- Platform: Mobile

**Description:**
In `app/(tabs)/reports.tsx`, the permission check at line 563 is a conditional render that returns early if Seller. But `React.useEffect(() => { loadReport(); }, [loadReport])` at line 553 runs on every render of the component — including the initial render BEFORE the early return at line 563 is evaluated. This means on first mount, `loadReport()` is called for Sellers (as a hook side-effect runs before the early return renders), making an API request that will return 403.

**Steps to reproduce:**
1. Sign in as Seller.
2. Navigate to Reports tab.
3. Network logs show a `GET /api/v1/reports/sales` request that returns 403.

**Expected:**
No API call should be made for roles that cannot view reports.

**Actual:**
`loadReport()` fires on first mount regardless of role, then the "access denied" screen renders.

**Root cause:**
`app/(tabs)/reports.tsx:553-555` — `useEffect` hook fires before the role-based early return at line 563.

---

### Bug 3: Offline stock report uses `sale_price` for `total_value` instead of `cost_price`
- Severity: Medium
- Role: Owner
- Platform: Mobile

**Description:**
In `computeLocalStockReport()` at `OfflineReportsUseCase.ts:256-259`:
```ts
const qty = p.stock_quantity ?? 0;
const salePrice = p.sale_price ?? 0;
const value = qty * salePrice;
```
The report labels this as "Общая стоимость" which is ambiguous. The server's stock report likely calculates total value at cost price (inventory cost). If the server returns cost-based total but the offline version returns sale-price-based total, the two diverge when the user goes online.

**Steps to reproduce:**
1. Go offline. View Stock report. Note "Общая стоимость".
2. Go online. View Stock report. Compare values.
3. Values differ if sale_price ≠ cost_price (they always differ in a healthy shop).

**Expected:**
Offline stock report should use `cost_price` for inventory value calculation (matching server behavior).

**Actual:**
`OfflineReportsUseCase.ts:258` — uses `sale_price` for stock value.

**Root cause:**
`lib/sync/usecases/OfflineReportsUseCase.ts:258` — `const salePrice = p.sale_price ?? 0` then `value = qty * salePrice`.

---

## Offline issues
- Both online and offline paths for reports are attempted: `isOnline` check runs first, but if `isOnline` flips during load, results may be from different sources.

## Mobile UX issues
- No loading skeleton for the tabs themselves — on slow devices the tab bar renders before data, causing a layout jump.
