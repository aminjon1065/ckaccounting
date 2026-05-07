// ─── Dashboard endpoint ─────────────────────────────────────────────────────

import { request } from "./client";

export type DashboardPeriod = "day" | "week" | "month" | "year" | "custom";

export interface LowStockItem {
  id: string;
  name: string;
  code: string;
  stock_quantity: number;
  low_stock_alert: number;
  unit?: string;
}

export interface RecentSaleItem {
  id: string;
  total: number;
  paid: number;
  debt: number;
  payment_type: "cash" | "card" | "transfer";
  created_at: string;
  customer_name?: string;
  actor_name?: string;
}

export interface RecentExpenseItem {
  id: string;
  name: string;
  total: number;
  created_at: string;
}

export interface RecentDebtTransactionItem {
  id: string;
  debt_id: string;
  person_name: string;
  amount: number;
  type: "give" | "take" | "repay";
  created_at: string;
}

export interface UnpaidDebtItem {
  id: string;
  person_name: string;
  balance: number;
  direction: "receivable" | "payable";
  created_at: string;
}

export interface DashboardSummary {
  period: DashboardPeriod;
  date_from: string;
  date_to: string;
  shop_id: number | null;
  period_sales_total: number;
  period_expenses_total: number;
  period_profit: number;
  period_cogs: number;
  debts_receivable: number;
  debts_payable: number;
  debts_net: number;
  stock_total_qty: number;
  stock_total_cost: number;
  stock_total_sales_value: number;
  low_stock_count: number;
  recent_sales: RecentSaleItem[];
  recent_expenses: RecentExpenseItem[];
  recent_debt_transactions: RecentDebtTransactionItem[];
  low_stock_products: LowStockItem[];
  unpaid_debts: UnpaidDebtItem[];
}

export const dashboardApi = {
  summary: (period: DashboardPeriod, token: string, shopId?: number | null, dateFrom?: string, dateTo?: string) =>
    request<DashboardSummary>(
      `/dashboard?period=${period}${shopId ? `&shop_id=${shopId}` : ""}${dateFrom ? `&date_from=${dateFrom}` : ""}${dateTo ? `&date_to=${dateTo}` : ""}`,
      { token }
    ),
};
