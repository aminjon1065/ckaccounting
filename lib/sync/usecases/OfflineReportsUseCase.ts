// ─── Offline reports use case ───────────────────────────────────────────────
//
// Aggregations against the local SQLite mirror — used by the reports tab
// when offline (or as a fallback when the network /reports endpoints time
// out). Mirrors the server's `SalesReport`, `ExpensesReport`, `ProfitReport`,
// `StockReport` shapes from `@/lib/api`.
//
// Money is stored exclusively in `*_kopecks` integer columns since
// migration v29 (the legacy REAL columns were dropped). Reads here go
// through `fromKopecks` (in the aggregator module) to convert back to
// rubles for the API-facing report shape.
//
// SHAPE
//
//   • The pure row→report transforms live in `OfflineReportsAggregators.ts`
//     so the regression suite can exercise them under jest's babel-only
//     transform without dragging in `expo-sqlite` (which is ESM and
//     breaks the pure-logic test environment).
//   • This file owns the SQLite hops and composes the aggregators.
//
// The v29 bug (reading dropped REAL columns) was invisible until typing
// forced the row shape; the tests around `aggregateSalesReport` /
// `aggregateStockReport` now make that class of bug fail at unit-test time.

import { getDb } from "../../db";
import { fromKopecks } from "../../db/money";
import type { ProfitReport, SalesReport, ExpensesReport, StockReport } from "../../api";
import {
  aggregateCostOfGoodsSold,
  aggregateExpensesReport,
  aggregateProfitReport,
  aggregateSalesReport,
  aggregateStockReport,
  isInDateRange,
  type DateRange,
  type ExpensesAggregateRow,
  type ProductAggregateRow,
  type ProfitSaleRow,
  type SaleItemAggregateRow,
  type SalesAggregateRow,
} from "./OfflineReportsAggregators";

export type {
  DateRange,
  SalesAggregateRow,
  ExpensesAggregateRow,
  ProductAggregateRow,
  SaleItemAggregateRow,
  ProfitSaleRow,
} from "./OfflineReportsAggregators";

export {
  aggregateSalesReport,
  aggregateExpensesReport,
  aggregateProfitReport,
  aggregateStockReport,
  aggregateCostOfGoodsSold,
  isInDateRange,
} from "./OfflineReportsAggregators";

// ─── Sales ──────────────────────────────────────────────────────────────────

async function fetchSalesRows(shopId?: number): Promise<SalesAggregateRow[]> {
  const db = getDb();
  let query = "SELECT id, type, payment_type, shop_id, created_at, total_kopecks FROM sales WHERE 1=1";
  const params: (string | number)[] = [];
  if (shopId !== undefined) {
    query += " AND shop_id = ?";
    params.push(shopId);
  }
  return db.getAllAsync<SalesAggregateRow>(query, params);
}

export async function computeLocalSalesReport(
  range: DateRange,
  shopId?: number
): Promise<SalesReport> {
  const rows = await fetchSalesRows(shopId);
  return aggregateSalesReport(rows, range);
}

// ─── Expenses ───────────────────────────────────────────────────────────────

async function fetchExpensesRows(shopId?: number): Promise<ExpensesAggregateRow[]> {
  const db = getDb();
  let query = "SELECT shop_id, created_at, total_kopecks FROM expenses WHERE 1=1";
  const params: (string | number)[] = [];
  if (shopId !== undefined) {
    query += " AND shop_id = ?";
    params.push(shopId);
  }
  return db.getAllAsync<ExpensesAggregateRow>(query, params);
}

export async function computeLocalExpensesReport(
  range: DateRange,
  shopId?: number
): Promise<ExpensesReport> {
  const rows = await fetchExpensesRows(shopId);
  return aggregateExpensesReport(rows, range);
}

// ─── Profit ─────────────────────────────────────────────────────────────────

export async function computeLocalProfitReport(
  range: DateRange,
  shopId?: number
): Promise<ProfitReport> {
  const db = getDb();

  const [salesResult, expensesResult] = await Promise.all([
    computeLocalSalesReport(range, shopId),
    computeLocalExpensesReport(range, shopId),
  ]);

  let salesQuery = "SELECT id, type, shop_id, created_at FROM sales WHERE 1=1";
  const salesParams: (string | number)[] = [];
  if (shopId !== undefined) {
    salesQuery += " AND shop_id = ?";
    salesParams.push(shopId);
  }
  const saleRows = await db.getAllAsync<ProfitSaleRow>(salesQuery, salesParams);

  // Batch-fetch sale_items in a single query — N+1 would explode on large
  // ranges. Filter the parent sale set first to keep the IN(...) bounded.
  const productSaleIds = saleRows
    .filter((s) => s.type === "product" && isInDateRange(s.created_at, range))
    .map((s) => s.id);

  let allSaleItems: SaleItemAggregateRow[] = [];
  if (productSaleIds.length > 0) {
    allSaleItems = await db.getAllAsync<SaleItemAggregateRow>(
      `SELECT sale_id, product_id, quantity FROM sale_items WHERE sale_id IN (${productSaleIds.map(() => "?").join(",")})`,
      productSaleIds
    );
  }

  // Product IDs are UUID strings since v24; cost lives in cost_price_kopecks
  // since v29. Reading the dropped REAL `cost_price` would silently zero
  // out COGS — that bug shipped pre-5.8 and is now caught at compile time.
  const allProductIds = [...new Set(allSaleItems.map((i) => i.product_id).filter((id): id is string => !!id))];
  const products = allProductIds.length > 0
    ? await db.getAllAsync<{ id: string; cost_price_kopecks: number | null }>(
        `SELECT id, cost_price_kopecks FROM products WHERE id IN (${allProductIds.map(() => "?").join(",")})`,
        allProductIds
      )
    : [];
  const productCostMap = new Map(products.map((p) => [p.id, fromKopecks(p.cost_price_kopecks)]));

  const totalCost = aggregateCostOfGoodsSold(saleRows, allSaleItems, productCostMap, range);
  return aggregateProfitReport(salesResult, expensesResult, totalCost, range);
}

// ─── Stock ──────────────────────────────────────────────────────────────────

async function fetchStockRows(shopId?: number): Promise<ProductAggregateRow[]> {
  const db = getDb();
  let query = "SELECT id, name, shop_id, stock_quantity, low_stock_alert, cost_price_kopecks, sale_price_kopecks FROM products WHERE 1=1";
  const params: (string | number)[] = [];
  if (shopId !== undefined) {
    query += " AND shop_id = ?";
    params.push(shopId);
  }
  return db.getAllAsync<ProductAggregateRow>(query, params);
}

export async function computeLocalStockReport(
  shopId?: number
): Promise<StockReport> {
  const rows = await fetchStockRows(shopId);
  return aggregateStockReport(rows);
}
