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
  total_value: number;
  low_stock: number;
  out_of_stock: number;
  data: {
    id: string;
    name: string;
    stock_quantity: number;
    sale_price: number;
    value: number;
  }[];
}

function normalizeStockReport(report: any): StockReport {
  const totalProducts = Number(report?.total_products ?? report?.products_count ?? 0);
  const totalValue = Number(report?.total_value ?? report?.stock_value_total ?? 0);
  const lowStock = Number(report?.low_stock ?? report?.low_stock_products_count ?? 0);
  const outOfStock = Number(report?.out_of_stock ?? report?.out_of_stock_products_count ?? 0);
  const data = Array.isArray(report?.data)
    ? report.data.map((item: any) => ({
        id: String(item?.id ?? ""),
        name: String(item?.name ?? ""),
        stock_quantity: Number(item?.stock_quantity ?? 0),
        sale_price: Number(item?.sale_price ?? 0),
        value: Number(item?.value ?? ((Number(item?.stock_quantity ?? 0)) * (Number(item?.sale_price ?? 0)))),
      }))
    : [];

  return {
    total_products: totalProducts,
    total_value: totalValue,
    low_stock: lowStock,
    out_of_stock: outOfStock,
    data,
  };
}

export const reportsApi = {
  sales: (
    token: string,
    params: { date_from?: string; date_to?: string } = {}
  ) => request<SalesReport>(`/reports/sales${qs(params)}`, { token }),

  expenses: (
    token: string,
    params: { date_from?: string; date_to?: string } = {}
  ) => request<ExpensesReport>(`/reports/expenses${qs(params)}`, { token }),

  profit: (
    token: string,
    params: { date_from?: string; date_to?: string } = {}
  ) => request<ProfitReport>(`/reports/profit${qs(params)}`, { token }),

  stock: (
    token: string,
    params: { date_from?: string; date_to?: string } = {}
  ) => request<any>(`/reports/stock${qs(params)}`, { token }).then(normalizeStockReport),
};
