import { getDb, type LocalSale, type LocalExpense, type LocalProduct } from "../../db";
import type { SalesReport, ExpensesReport, ProfitReport, StockReport } from "../../api";

interface DateRange {
  dateFrom?: string;
  dateTo?: string;
}

interface ShopFilter {
  shopId?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function isInDateRange(
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

// ─── Sales Report ─────────────────────────────────────────────────────────────

export async function computeLocalSalesReport(
  range: DateRange,
  shopId?: number
): Promise<SalesReport> {
  const db = getDb();

  let query = "SELECT * FROM sales WHERE 1=1";
  const params: any[] = [];
  if (shopId !== undefined) {
    query += " AND shop_id = ?";
    params.push(shopId);
  }

  const rows = await db.getAllAsync<any>(query, params);
  const sales = rows.filter((r) => {
    if (!isInDateRange(r.created_at, range)) return false;
    // Only count real sales (not local pending that might be duplicates)
    return true;
  });

  const dateMap = new Map<string, { count: number; amount: number }>();

  let totalAmount = 0;
  let totalCount = 0;
  let cashTotal = 0;
  let cardTotal = 0;
  let transferTotal = 0;

  for (const s of sales) {
    const day = toDateStr(startOfDay(new Date(s.created_at)));
    const entry = dateMap.get(day) ?? { count: 0, amount: 0 };
    entry.count++;
    entry.amount += s.total ?? 0;
    dateMap.set(day, entry);

    totalCount++;
    totalAmount += s.total ?? 0;

    const pt = (s.payment_type as string) ?? "cash";
    if (pt === "cash") cashTotal += s.total ?? 0;
    else if (pt === "card") cardTotal += s.total ?? 0;
    else if (pt === "transfer") transferTotal += s.total ?? 0;
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

// ─── Expenses Report ──────────────────────────────────────────────────────────

export async function computeLocalExpensesReport(
  range: DateRange,
  shopId?: number
): Promise<ExpensesReport> {
  const db = getDb();

  let query = "SELECT * FROM expenses WHERE 1=1";
  const params: any[] = [];
  if (shopId !== undefined) {
    query += " AND shop_id = ?";
    params.push(shopId);
  }

  const rows = await db.getAllAsync<any>(query, params);
  const expenses = rows.filter((r) =>
    isInDateRange(r.created_at, range)
  );

  const dateMap = new Map<string, { count: number; amount: number }>();

  let totalAmount = 0;
  let totalCount = 0;

  for (const e of expenses) {
    const day = toDateStr(startOfDay(new Date(e.created_at)));
    const entry = dateMap.get(day) ?? { count: 0, amount: 0 };
    entry.count++;
    entry.amount += e.total ?? 0;
    dateMap.set(day, entry);

    totalCount++;
    totalAmount += e.total ?? 0;
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

// ─── Profit Report ─────────────────────────────────────────────────────────────

export async function computeLocalProfitReport(
  range: DateRange,
  shopId?: number
): Promise<ProfitReport> {
  const db = getDb();

  const [salesResult, expensesResult] = await Promise.all([
    computeLocalSalesReport(range, shopId),
    computeLocalExpensesReport(range, shopId),
  ]);

  // Cost of goods sold: sum of cost_price * quantity for product-type sales
  let totalCost = 0;

  let salesQuery = "SELECT * FROM sales WHERE 1=1";
  const salesParams: any[] = [];
  if (shopId !== undefined) {
    salesQuery += " AND shop_id = ?";
    salesParams.push(shopId);
  }

  const saleRows = await db.getAllAsync<any>(salesQuery, salesParams);
  const filteredSales = saleRows.filter((r) =>
    isInDateRange(r.created_at, range)
  );

  for (const sale of filteredSales) {
    if (sale.type === "product") {
      // Try to get sale items to compute cost
      const items = await db.getAllAsync<any>(
        "SELECT * FROM sale_items WHERE sale_local_id = ?",
        [sale.local_id]
      );
      for (const item of items) {
        // cost = unit_price - (unit_price * markup / 100) approximation
        // Since we don't store cost per sale item, we use a best-effort estimate:
        // We use the product's cost_price from the products table
        if (item.product_id) {
          const product = await db.getFirstAsync<any>(
            "SELECT cost_price FROM products WHERE id = ?",
            [item.product_id]
          );
          if (product) {
            totalCost += (product.cost_price ?? 0) * item.quantity;
          }
        }
      }
    }
  }

  const totalSales = salesResult.total_amount;
  const totalExpenses = expensesResult.total_amount;
  const profit = totalSales - totalExpenses - totalCost;

  return {
    total_sales: totalSales,
    total_expenses: totalExpenses,
    total_cost: totalCost,
    profit,
    date_from: range.dateFrom ?? "",
    date_to: range.dateTo ?? "",
  };
}

// ─── Stock Report ───────────────────────────────────────────────────────────────

export async function computeLocalStockReport(
  shopId?: number
): Promise<StockReport> {
  const db = getDb();

  let query = "SELECT * FROM products WHERE 1=1";
  const params: any[] = [];
  if (shopId !== undefined) {
    query += " AND shop_id = ?";
    params.push(shopId);
  }

  const rows = await db.getAllAsync<any>(query, params);

  let totalProducts = 0;
  let totalValue = 0;
  let lowStock = 0;
  let outOfStock = 0;
  const data: StockReport["data"] = [];

  for (const p of rows) {
    const qty = p.stock_quantity ?? 0;
    const salePrice = p.sale_price ?? 0;
    const value = qty * salePrice;

    totalProducts++;
    totalValue += value;

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
      value,
    });
  }

  return {
    total_products: totalProducts,
    total_value: totalValue,
    low_stock: lowStock,
    out_of_stock: outOfStock,
    data,
  };
}
