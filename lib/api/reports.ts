// ─── Reports endpoints ──────────────────────────────────────────────────────
//
// `normalizeStockReport` is here because the backend has shipped two
// shapes for `/reports/stock` over time (`total_products` vs
// `products_count`, etc.). Normalizing at this boundary keeps callers
// from caring which one they got.

import { request, qs } from "./client";

export interface SalesReportReturnRow {
  sale_return_id: string;
  sale_id: string;
  created_at: string | null;
  reason: string | null;
  refund_method: string | null;
  seller_name: string | null;
  product_name: string | null;
  unit: string | null;
  quantity: number;
  price: number;
  total: number;
}

export interface SalesReport {
  total_sales: number;
  /** Net amount: gross sales − returns. Renders as the headline figure. */
  total_amount: number;
  /** Gross sales total before returns. Exposed so the UI can show the
   *  "минус возвраты" breakdown line. Server includes this in 2026+. */
  sales_gross?: number;
  /** Refunds processed inside the report window. */
  returns_total?: number;
  /** Per-line breakdown of returns inside the report window. Populated
   *  only when `returns_total > 0` (server skips the query otherwise to
   *  keep the payload light). Rendered as the "Возвраты" table in the
   *  PDF export. Older servers omit this field. */
  returns?: SalesReportReturnRow[];
  cash: number;
  card: number;
  transfer: number;
  date_from: string;
  date_to: string;
  data: { date: string; count: number; amount: number }[];
}

export interface ExpenseReportItem {
  id: string;
  name: string;
  unit?: string | null;
  quantity: number;
  price: number;
  total: number;
  note?: string | null;
  created_at: string;
}

export interface ExpensesReport {
  total_amount: number;
  count: number;
  date_from: string;
  date_to: string;
  data: { date: string; count: number; amount: number }[];
  /** Per-row breakdown for the PDF export. Added 2026-05; may be
   *  missing on older servers, so callers should guard with `?? []`. */
  items?: ExpenseReportItem[];
}

export interface ProfitReport {
  total_sales: number;
  total_expenses: number;
  total_cost: number;
  profit: number;
  /** Gross sales before returns. */
  sales_gross?: number;
  /** Money refunded back to customers in the window. */
  returns_total?: number;
  /** Original cost of returned goods (reverses COGS). */
  returns_cogs?: number;
  date_from: string;
  date_to: string;
}

export interface StockReportRow {
  id: string;
  name: string;
  unit?: string | null;
  /** Closing balance (period mode) or current stock (snapshot mode). */
  stock_quantity: number;
  sale_price: number;
  cost_price: number;
  /** stock × sale_price */
  value: number;
  /** stock × cost_price */
  cost_value: number;
  // ── Period-mode extras (omitted in snapshot mode) ──
  opening_qty?: number;
  incoming_qty?: number;
  outgoing_qty?: number;
  returned_qty?: number;
  closing_qty?: number;
  closing_value?: number;
  closing_cost_value?: number;
}

export interface StockReport {
  /** Distinguishes the two modes — UI / PDF render different columns. */
  mode?: "snapshot" | "period";
  /** Only present in period mode. */
  date_from?: string;
  date_to?: string;
  total_products: number;
  /** Σ(stock_quantity × sale_price) — what the inventory would bring in if sold. */
  total_value: number;
  /** Σ(stock_quantity × cost_price) — what the inventory cost to acquire. */
  total_cost_value: number;
  low_stock: number;
  out_of_stock: number;
  // ── Period-mode aggregates ──
  opening_qty?: number;
  incoming_qty?: number;
  outgoing_qty?: number;
  returned_qty?: number;
  closing_qty?: number;
  data: StockReportRow[];
}

function normalizeStockReport(report: any): StockReport {
  const totalProducts = Number(report?.total_products ?? report?.products_count ?? 0);
  const totalValue = Number(report?.total_value ?? report?.stock_value_total ?? 0);
  const totalCostValue = Number(report?.total_cost_value ?? 0);
  const lowStock = Number(report?.low_stock ?? report?.low_stock_products_count ?? 0);
  const outOfStock = Number(report?.out_of_stock ?? report?.out_of_stock_products_count ?? 0);
  const mode: "snapshot" | "period" = report?.mode === "period" ? "period" : "snapshot";
  const data: StockReportRow[] = Array.isArray(report?.data)
    ? report.data.map((item: any) => {
        const qty = Number(item?.stock_quantity ?? item?.closing_qty ?? 0);
        const salePrice = Number(item?.sale_price ?? 0);
        const costPrice = Number(item?.cost_price ?? 0);
        return {
          id: String(item?.id ?? ""),
          name: String(item?.name ?? ""),
          unit: item?.unit ?? null,
          stock_quantity: qty,
          sale_price: salePrice,
          cost_price: costPrice,
          value: Number(item?.value ?? qty * salePrice),
          cost_value: Number(item?.cost_value ?? qty * costPrice),
          opening_qty: item?.opening_qty != null ? Number(item.opening_qty) : undefined,
          incoming_qty: item?.incoming_qty != null ? Number(item.incoming_qty) : undefined,
          outgoing_qty: item?.outgoing_qty != null ? Number(item.outgoing_qty) : undefined,
          returned_qty: item?.returned_qty != null ? Number(item.returned_qty) : undefined,
          closing_qty: item?.closing_qty != null ? Number(item.closing_qty) : undefined,
          closing_value: item?.closing_value != null ? Number(item.closing_value) : undefined,
          closing_cost_value: item?.closing_cost_value != null ? Number(item.closing_cost_value) : undefined,
        };
      })
    : [];

  return {
    mode,
    date_from: report?.date_from,
    date_to: report?.date_to,
    total_products: totalProducts,
    total_value: totalValue,
    total_cost_value: totalCostValue,
    low_stock: lowStock,
    out_of_stock: outOfStock,
    opening_qty: report?.opening_qty != null ? Number(report.opening_qty) : undefined,
    incoming_qty: report?.incoming_qty != null ? Number(report.incoming_qty) : undefined,
    outgoing_qty: report?.outgoing_qty != null ? Number(report.outgoing_qty) : undefined,
    returned_qty: report?.returned_qty != null ? Number(report.returned_qty) : undefined,
    closing_qty: report?.closing_qty != null ? Number(report.closing_qty) : undefined,
    data,
  };
}

type ReportParams = { date_from?: string; date_to?: string; shop_id?: number };

export const reportsApi = {
  sales: (token: string, params: ReportParams = {}) =>
    request<SalesReport>(`/reports/sales${qs(params)}`, { token }),

  expenses: (token: string, params: ReportParams = {}) =>
    request<ExpensesReport>(`/reports/expenses${qs(params)}`, { token }),

  profit: (token: string, params: ReportParams = {}) =>
    request<ProfitReport>(`/reports/profit${qs(params)}`, { token }),

  stock: (token: string, params: ReportParams = {}) =>
    request<any>(`/reports/stock${qs(params)}`, { token }).then(normalizeStockReport),
};
