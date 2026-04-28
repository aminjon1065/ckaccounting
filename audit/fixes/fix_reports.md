# Fix Plan: reports

### Fix for Bug 1: N+1 query in `computeLocalProfitReport`

**Goal:** Replace per-item product lookups with a single JOIN query.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/usecases/OfflineReportsUseCase.ts`

**Changes:**
Replace the nested loop starting at line 195 with a single aggregated SQL query:
```ts
// REPLACE lines 183-230 in computeLocalProfitReport with:

// Cost of goods sold: sum(cost_price * quantity) for product-type sales in range
let totalCost = 0;
const shopFilter = shopId !== undefined ? "AND s.shop_id = ?" : "";
const shopParams = shopId !== undefined ? [shopId] : [];

const cogsRows = await db.getAllAsync<{ cogs: number }>(
  `SELECT COALESCE(SUM(
    CASE WHEN p.cost_price_kopecks IS NOT NULL
      THEN (p.cost_price_kopecks / 100.0) * si.quantity
      ELSE p.cost_price * si.quantity
    END
  ), 0) AS cogs
  FROM sales s
  JOIN sale_items si ON si.sale_local_id = s.local_id OR si.sale_id = s.id
  JOIN products p ON p.id = si.product_id
  WHERE s.type = 'product'
    AND s.created_at >= ? AND s.created_at <= ?
    ${shopFilter}`,
  [
    range.dateFrom ? `${range.dateFrom}T00:00:00.000Z` : "1970-01-01T00:00:00Z",
    range.dateTo ? `${range.dateTo}T23:59:59.999Z` : new Date().toISOString(),
    ...shopParams,
  ]
);
totalCost = cogsRows[0]?.cogs ?? 0;
```

**Edge cases:**
- `sale_items` join key may be `sale_local_id` or `sale_id`. Verify schema and use the correct column.
- If `cost_price_kopecks` is NULL, fall back to the float `cost_price` column.

**Validation:**
1. Create 100 sales with 3 items each.
2. Open offline profit report — renders in < 500ms.
3. Values match online report (within rounding tolerance).

---

### Fix for Bug 2: `loadReport()` called for Sellers before permission check

**Goal:** Skip `loadReport()` when user lacks `reports:view` permission.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/(tabs)/reports.tsx`

**Changes:**
Add a permission guard inside `loadReport`:
```ts
const loadReport = React.useCallback(async () => {
  // Guard: do not load if user doesn't have permission
  if (!can(user?.role, "reports:view")) return;
  if (!token) return;
  // ... rest of existing function
}, [activeTab, dateFrom, dateTo, token, isOnline, user?.shop_id, user?.role]);
```

Or equivalently, add the check to the useEffect:
```ts
React.useEffect(() => {
  if (can(user?.role, "reports:view")) {
    loadReport();
  }
}, [loadReport, user?.role]);
```

**Validation:**
1. Sign in as Seller → navigate to Reports → no network request in proxy logs.
2. Sign in as Owner → Reports tab → API request fired normally.

---

### Fix for Bug 3: Offline stock report uses `sale_price` instead of `cost_price`

**Goal:** Use `cost_price` for stock inventory value in offline stock report.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/usecases/OfflineReportsUseCase.ts`

**Changes:**
```ts
// In computeLocalStockReport(), replace lines 256-259:
// BEFORE
const qty = p.stock_quantity ?? 0;
const salePrice = p.sale_price ?? 0;
const value = qty * salePrice;

// AFTER
const qty = p.stock_quantity ?? 0;
// Use cost_price for inventory valuation (matches server-side stock report)
const costPrice = p.cost_price ?? 0;
const value = qty * costPrice;
```
Also update the `data.push` to include correct price reference:
```ts
data.push({
  id: p.id,
  name: p.name,
  stock_quantity: qty,
  sale_price: p.sale_price ?? 0,  // Keep sale_price for display reference
  value,  // now cost-based
});
```

**Edge cases:**
- The UI label "Общая стоимость" is still appropriate for cost-based valuation.
- Sellers cannot view Reports so this only affects Owner.

**Validation:**
1. Create products with cost_price=100, sale_price=150, qty=10.
2. Online stock report shows total_value=1000 (cost-based).
3. Go offline. Stock report shows total_value=1000 (matching).
