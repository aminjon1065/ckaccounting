// ─── Offline reports — pure aggregators ─────────────────────────────────────
//
// Row → API report transformations, with zero DB or runtime dependency.
// Lives in its own file so the regression suite can import it under
// jest's babel-only transform without dragging in `expo-sqlite` (which
// is ESM and breaks the pure-logic test environment).
//
// The compose layer in `offlineReports.ts` does the SQLite hop and
// delegates here; tests import directly.

import { fromKopecks } from "../db/money";
import type { SalesReport, ExpensesReport, ProfitReport, StockReport } from "../api";

export interface DateRange {
  dateFrom?: string;
  dateTo?: string;
}

// ─── Row types ──────────────────────────────────────────────────────────────

/** Subset of `sales` columns the sales aggregator reads. */
export interface SalesAggregateRow {
  id: string;
  type: "product" | "service" | null;
  payment_type: "cash" | "card" | "transfer" | null;
  shop_id: number | null;
  created_at: string | null;
  total_kopecks: number | null;
}

export interface ExpensesAggregateRow {
  shop_id: number | null;
  created_at: string | null;
  total_kopecks: number | null;
}

export interface SaleItemAggregateRow {
  sale_id: string;
  product_id: string | null;
  quantity: number;
}

export interface ProductAggregateRow {
  id: string;
  name: string;
  shop_id: number | null;
  stock_quantity: number | null;
  low_stock_alert: number | null;
  cost_price_kopecks: number | null;
  sale_price_kopecks: number | null;
}

/** Subset used by the profit COGS path — sales without total/payment. */
export interface ProfitSaleRow {
  id: string;
  type: "product" | "service" | null;
  shop_id: number | null;
  created_at: string | null;
}

// ─── Date helpers ───────────────────────────────────────────────────────────

function parseDate(str: string | null | undefined): Date | null {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isInDateRange(
  dateStr: string | null | undefined,
  range: DateRange
): boolean {
  if (!dateStr) return false;
  const d = parseDate(dateStr);
  if (!d) return false;
  const day = startOfDay(d);
  if (range.dateFrom) {
    const from = startOfDay(new Date(range.dateFrom));
    if (day < from) return false;
  }
  if (range.dateTo) {
    const to = endOfDay(new Date(range.dateTo));
    if (day > to) return false;
  }
  return true;
}

// ─── Sales report ───────────────────────────────────────────────────────────

export function aggregateSalesReport(
  rows: SalesAggregateRow[],
  range: DateRange
): SalesReport {
  const sales = rows.filter((r) => isInDateRange(r.created_at, range));

  const dateMap = new Map<string, { count: number; amount: number }>();

  let totalAmount = 0;
  let totalCount = 0;
  let cashTotal = 0;
  let cardTotal = 0;
  let transferTotal = 0;

  for (const s of sales) {
    if (!s.created_at) continue;
    const day = toDateStr(startOfDay(new Date(s.created_at)));
    const amount = fromKopecks(s.total_kopecks);
    const entry = dateMap.get(day) ?? { count: 0, amount: 0 };
    entry.count++;
    entry.amount += amount;
    dateMap.set(day, entry);

    totalCount++;
    totalAmount += amount;

    const pt = s.payment_type ?? "cash";
    if (pt === "cash") cashTotal += amount;
    else if (pt === "card") cardTotal += amount;
    else if (pt === "transfer") transferTotal += amount;
  }

  const data = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { count, amount }]) => ({ date, count, amount }));

  return {
    total_sales: totalCount,
    total_amount: totalAmount,
    cash: cashTotal,
    card: cardTotal,
    transfer: transferTotal,
    date_from: range.dateFrom ?? "",
    date_to: range.dateTo ?? "",
    data,
  };
}

// ─── Expenses report ────────────────────────────────────────────────────────

export function aggregateExpensesReport(
  rows: ExpensesAggregateRow[],
  range: DateRange
): ExpensesReport {
  const expenses = rows.filter((r) => isInDateRange(r.created_at, range));

  const dateMap = new Map<string, { count: number; amount: number }>();

  let totalAmount = 0;
  let totalCount = 0;

  for (const e of expenses) {
    if (!e.created_at) continue;
    const day = toDateStr(startOfDay(new Date(e.created_at)));
    const amount = fromKopecks(e.total_kopecks);
    const entry = dateMap.get(day) ?? { count: 0, amount: 0 };
    entry.count++;
    entry.amount += amount;
    dateMap.set(day, entry);

    totalCount++;
    totalAmount += amount;
  }

  const data = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { count, amount }]) => ({ date, count, amount }));

  return {
    total_amount: totalAmount,
    count: totalCount,
    date_from: range.dateFrom ?? "",
    date_to: range.dateTo ?? "",
    data,
  };
}

// ─── Profit / COGS ──────────────────────────────────────────────────────────

/**
 * COGS (cost of goods sold) = Σ(cost_price * quantity) over all sale_items
 * whose parent sale is product-type and inside the date range. The
 * `productCostMap` is provided by the caller so the function stays pure
 * and the DB hits stay in `computeLocalProfitReport`.
 */
export function aggregateCostOfGoodsSold(
  saleRows: ProfitSaleRow[],
  saleItems: SaleItemAggregateRow[],
  productCostMap: Map<string, number>,
  range: DateRange
): number {
  const inRangeProductSaleIds = new Set(
    saleRows
      .filter((s) => s.type === "product" && isInDateRange(s.created_at, range))
      .map((s) => s.id)
  );

  let totalCost = 0;
  for (const item of saleItems) {
    if (!inRangeProductSaleIds.has(item.sale_id)) continue;
    if (!item.product_id) continue;
    totalCost += (productCostMap.get(item.product_id) ?? 0) * item.quantity;
  }
  return totalCost;
}

export function aggregateProfitReport(
  salesReport: SalesReport,
  expensesReport: ExpensesReport,
  totalCost: number,
  range: DateRange
): ProfitReport {
  return {
    total_sales: salesReport.total_amount,
    total_expenses: expensesReport.total_amount,
    total_cost: totalCost,
    profit: salesReport.total_amount - expensesReport.total_amount - totalCost,
    date_from: range.dateFrom ?? "",
    date_to: range.dateTo ?? "",
  };
}

// ─── Stock report ───────────────────────────────────────────────────────────

export function aggregateStockReport(rows: ProductAggregateRow[]): StockReport {
  let totalProducts = 0;
  let totalValue = 0;
  let totalCostValue = 0;
  let lowStock = 0;
  let outOfStock = 0;
  const data: StockReport["data"] = [];

  for (const p of rows) {
    const qty = p.stock_quantity ?? 0;
    const costPrice = fromKopecks(p.cost_price_kopecks);
    const salePrice = fromKopecks(p.sale_price_kopecks);
    const costValue = qty * costPrice;
    const saleValue = qty * salePrice;

    totalProducts++;
    totalValue += saleValue;
    totalCostValue += costValue;

    const alert = p.low_stock_alert ?? 0;
    if (qty === 0) {
      outOfStock++;
    } else if (alert > 0 && qty <= alert) {
      lowStock++;
    }

    data.push({
      id: p.id,
      name: p.name,
      stock_quantity: qty,
      sale_price: salePrice,
      cost_price: costPrice,
      value: saleValue,
      cost_value: costValue,
    });
  }

  return {
    total_products: totalProducts,
    total_value: totalValue,
    total_cost_value: totalCostValue,
    low_stock: lowStock,
    out_of_stock: outOfStock,
    data,
  };
}
