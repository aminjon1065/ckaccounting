# Fix Plan: dashboard

### Fix for Bug 1: DashboardService returns financial fields to Seller

**Goal:** Strip cost/profit/expense fields from dashboard API response when the user is a Seller.

**Files to modify:**
- `acc-backend/app/Services/Api/V1/DashboardService.php` (or the relevant resource/transformer)
- `acc-backend/app/Http/Controllers/Api/V1/DashboardController.php`

**Changes:**
Option A — Strip in controller before returning JSON:
```php
// In DashboardController::show(), after $data is built:
if ($sellerId !== null) {
    unset(
        $data['period_cogs'],
        $data['period_profit'],
        $data['period_expenses_total'],
        $data['stock_total_cost'],
    );
}
```

Option B (cleaner) — Pass a flag to DashboardService to skip computing those fields:
1. Add `bool $hideCostData = false` param to `DashboardService::build()`.
2. When `$hideCostData === true`, skip the COGS / profit / expense queries and set those fields to null in the response.
3. Call with `$hideCostData: $sellerId !== null`.

**Edge cases:**
- super_admin viewing a seller's scoped shop must still see full financials.
- Cached responses (Cache::remember) must be keyed per role or bypassed for sellers (already done for sellers at DashboardController:33).

**Validation:**
Authenticate as Seller. `GET /api/v1/dashboard`. Confirm `period_cogs`, `period_profit`, `stock_total_cost` are absent or null in response.

---

### Fix for Bug 2: Unreliable `isOffline` detection in `useDashboard`

**Goal:** Only treat genuine network-unreachable errors as offline.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/hooks/useDashboard.ts`

**Changes:**
Replace line 39:
```ts
// BEFORE
const isOfflineError = err?.status === 0 || !err?.message?.includes("status");
// AFTER
const isOfflineError =
  err?.status === 0 ||
  err?.message === "Network request failed" ||
  err?.message?.includes("Network request failed");
```

**Edge cases:**
- 5xx errors should show the generic error banner, not the stale cache.
- `err?.status === 0` already catches the fetch-level network failure.

**Validation:**
1. Kill network → dashboard shows "Офлайн режим" with cached data.
2. Server returns 500 → dashboard shows "Ошибка загрузки" error banner, no cache fallback.

---

### Fix for Bug 3: `StockInfoCard` and `ZakatCard` visible to Sellers

**Goal:** Hide cost-price-derived cards from Seller role on the dashboard.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/(tabs)/index.tsx`

**Changes:**
Wrap both cards with a Seller guard:
```tsx
// In app/(tabs)/index.tsx, around line 188-215
{summary && !loading && (
  <View className="flex-row px-5 mb-2 items-stretch gap-4">
    {/* Left column */}
    <View className="flex-1 gap-4">
      <StockInfoCard
        totalQty={summary.stock_total_qty ?? 0}
        totalCost={user?.role !== "seller" ? (summary.stock_total_cost ?? 0) : 0}
        totalSalesValue={summary.stock_total_sales_value ?? 0}
        isDataHidden={isDataHidden}
        onPress={() => router.push("/(tabs)/products")}
      />
      <DebtsCard
        receivables={summary.debts_receivable ?? 0}
        payables={summary.debts_payable ?? 0}
        isDataHidden={isDataHidden}
      />
    </View>

    {/* Right column — hide Zakat (cost-based) from Sellers */}
    {user?.role !== "seller" && (
      <View className="w-32">
        <ZakatCard
          totalCost={summary.stock_total_cost ?? 0}
          receivables={summary.debts_receivable ?? 0}
          payables={summary.debts_payable ?? 0}
          isDataHidden={isDataHidden}
        />
      </View>
    )}
  </View>
)}
```

**Edge cases:**
- `StockInfoCard` may render a "0" cost column — update the component to hide the cost row when `totalCost === 0 && isSeller`.

**Validation:**
1. Sign in as Seller → Zakat card absent, StockInfoCard shows no cost row.
2. Sign in as Owner → both cards visible with real values.
