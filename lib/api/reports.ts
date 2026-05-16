// ─── Reports endpoints ──────────────────────────────────────────────────────
//
// `normalizeStockReport` is here because the backend has shipped two
// shapes for `/reports/stock` over time (`total_products` vs
// `products_count`, etc.). Normalizing at this boundary keeps callers
// from caring which one they got.

import { request, qs } from "./client";

export interface SalesReport {
  total_sales: number;
  total_amount: number;
  cash: number;
  card: number;
  transfer: number;
  date_from: string;
  date_to: string;
  data: { date: string; count: number; amount: number }[];
}

export interface ExpensesReport {
  total_amount: number;
  count: number;
  date_from: string;
  date_to: string;
  data: { date: string; count: number; amount: number }[];
}

export interface ProfitReport {
  total_sales: number;
  total_expenses: number;
  total_cost: number;
  profit: number;
  date_from: string;
  date_to: string;
}

export interface StockReport {
  total_products: number;
  /** Σ(stock_quantity × sale_price) — what the inventory would bring in if sold. */
  total_value: number;
  /** Σ(stock_quantity × cost_price) — what the inventory cost to acquire. */
  total_cost_value: number;
  low_stock: number;
  out_of_stock: number;
  data: {
    id: string;
    name: string;
    stock_quantity: number;
    sale_price: number;
    cost_price: number;
    /** stock × sale_price */
    value: number;
    /** stock × cost_price */
    cost_value: number;
  }[];
}

function normalizeStockReport(report: any): StockReport {
  const totalProducts = Number(report?.total_products ?? report?.products_count ?? 0);
  const totalValue = Number(report?.total_value ?? report?.stock_value_total ?? 0);
  const totalCostValue = Number(report?.total_cost_value ?? 0);
  const lowStock = Number(report?.low_stock ?? report?.low_stock_products_count ?? 0);
  const outOfStock = Number(report?.out_of_stock ?? report?.out_of_stock_products_count ?? 0);
  const data = Array.isArray(report?.data)
    ? report.data.map((item: any) => {
        const qty = Number(item?.stock_quantity ?? 0);
        const salePrice = Number(item?.sale_price ?? 0);
        const costPrice = Number(item?.cost_price ?? 0);
        return {
          id: String(item?.id ?? ""),
          name: String(item?.name ?? ""),
          stock_quantity: qty,
          sale_price: salePrice,
          cost_price: costPrice,
          value: Number(item?.value ?? qty * salePrice),
          cost_value: Number(item?.cost_value ?? qty * costPrice),
        };
      })
    : [];

  return {
    total_products: totalProducts,
    total_value: totalValue,
    total_cost_value: totalCostValue,
    low_stock: lowStock,
    out_of_stock: outOfStock,
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
