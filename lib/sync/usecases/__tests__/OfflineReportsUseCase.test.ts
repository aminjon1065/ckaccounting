// ─── Offline reports regression suite ───────────────────────────────────────
//
// Locks down the v29 kopecks-column fix from phase 5.8. Every aggregator
// is exercised against fixtures shaped exactly like the SELECT in its
// fetch counterpart — if a future migration drops or renames a column
// without updating the row type, these tests fail before the bug ships.
//
// Specifically guards against:
//   • reading `total` / `cost_price` / `sale_price` (REAL columns dropped
//     in v29) — the row types now use `*_kopecks`.
//   • product_id treated as `number` (was true before v24, false after).
//   • payment-type split skipping `"transfer"` / accidentally double-counting.
//   • date-range filter ignoring the local timezone (we anchor on the
//     calendar day, not absolute UTC milliseconds).
//
// TIMEZONE: the date-range filter is intentionally local-time anchored
// (an accounting "day" is the user's calendar day, not a UTC slice).
// The npm test script sets TZ=UTC so fixture timestamps always land on
// the calendar day they read — without this, "T20:00Z on March 10" rolls
// into March 11 on Asia hosts and tests fail nondeterministically.

import {
  aggregateCostOfGoodsSold,
  aggregateExpensesReport,
  aggregateProfitReport,
  aggregateSalesReport,
  aggregateStockReport,
  isInDateRange,
  type ExpensesAggregateRow,
  type ProductAggregateRow,
  type ProfitSaleRow,
  type SaleItemAggregateRow,
  type SalesAggregateRow,
} from "../OfflineReportsAggregators";

// ─── isInDateRange ──────────────────────────────────────────────────────────

describe("isInDateRange", () => {
  it("returns false for null/empty/invalid date strings", () => {
    expect(isInDateRange(null, {})).toBe(false);
    expect(isInDateRange("", {})).toBe(false);
    expect(isInDateRange("not-a-date", {})).toBe(false);
  });

  it("returns true when no range is specified", () => {
    expect(isInDateRange("2026-03-15T10:00:00.000Z", {})).toBe(true);
  });

  it("includes both range endpoints (start-of-day for from, end-of-day for to)", () => {
    const range = { dateFrom: "2026-03-01", dateTo: "2026-03-31" };
    expect(isInDateRange("2026-03-01T00:00:00.000Z", range)).toBe(true);
    expect(isInDateRange("2026-03-31T23:59:59.000Z", range)).toBe(true);
  });

  it("excludes dates before from / after to", () => {
    const range = { dateFrom: "2026-03-01", dateTo: "2026-03-31" };
    expect(isInDateRange("2026-02-28T23:59:59.000Z", range)).toBe(false);
    expect(isInDateRange("2026-04-01T00:00:01.000Z", range)).toBe(false);
  });
});

// ─── Sales report ───────────────────────────────────────────────────────────

describe("aggregateSalesReport", () => {
  // Fixtures use kopecks (1 ruble = 100 kopecks). 12_345_67 = 12,345.67 RUB.
  const rows: SalesAggregateRow[] = [
    { id: "s1", type: "product", payment_type: "cash",     shop_id: 1, created_at: "2026-03-10T08:00:00.000Z", total_kopecks: 100_00 },
    { id: "s2", type: "product", payment_type: "card",     shop_id: 1, created_at: "2026-03-10T14:00:00.000Z", total_kopecks: 250_00 },
    { id: "s3", type: "service", payment_type: "transfer", shop_id: 1, created_at: "2026-03-11T11:00:00.000Z", total_kopecks: 800_00 },
    { id: "s4", type: "product", payment_type: "cash",     shop_id: 1, created_at: "2026-04-01T11:00:00.000Z", total_kopecks: 999_99 },
  ];

  it("converts kopecks to rubles when summing total_amount", () => {
    const report = aggregateSalesReport(rows, {});
    // 100 + 250 + 800 + 999.99 = 2149.99
    expect(report.total_amount).toBeCloseTo(2149.99, 2);
    expect(report.total_sales).toBe(4);
  });

  it("splits payment types correctly without double-counting", () => {
    const report = aggregateSalesReport(rows, {});
    expect(report.cash).toBeCloseTo(100 + 999.99, 2);
    expect(report.card).toBe(250);
    expect(report.transfer).toBe(800);
    expect(report.cash + report.card + report.transfer).toBeCloseTo(report.total_amount, 2);
  });

  it("treats null payment_type as cash (server's documented default)", () => {
    const report = aggregateSalesReport(
      [{ id: "x", type: "product", payment_type: null, shop_id: null, created_at: "2026-03-10T10:00:00.000Z", total_kopecks: 50_00 }],
      {}
    );
    expect(report.cash).toBe(50);
    expect(report.card).toBe(0);
    expect(report.transfer).toBe(0);
  });

  it("groups daily totals and sorts ascending by date", () => {
    const report = aggregateSalesReport(rows, {});
    expect(report.data).toHaveLength(3);
    expect(report.data[0].date < report.data[1].date).toBe(true);
    expect(report.data[1].date < report.data[2].date).toBe(true);

    // March 10 had two sales summing to 350.
    const mar10 = report.data.find((d) => d.date === "2026-03-10");
    expect(mar10).toEqual({ date: "2026-03-10", count: 2, amount: 350 });
  });

  it("filters out rows outside the date range", () => {
    const report = aggregateSalesReport(rows, { dateFrom: "2026-03-01", dateTo: "2026-03-31" });
    expect(report.total_sales).toBe(3);
    expect(report.total_amount).toBeCloseTo(100 + 250 + 800, 2);
    expect(report.data.find((d) => d.date === "2026-04-01")).toBeUndefined();
  });

  it("survives total_kopecks = null (treats as 0)", () => {
    const report = aggregateSalesReport(
      [{ id: "x", type: "product", payment_type: "cash", shop_id: null, created_at: "2026-03-10T10:00:00.000Z", total_kopecks: null }],
      {}
    );
    expect(report.total_amount).toBe(0);
    expect(report.total_sales).toBe(1);
  });

  it("rejects rows with null created_at (cannot place them on a day)", () => {
    const report = aggregateSalesReport(
      [{ id: "x", type: "product", payment_type: "cash", shop_id: null, created_at: null, total_kopecks: 100_00 }],
      {}
    );
    expect(report.total_sales).toBe(0);
  });
});

// ─── Expenses report ────────────────────────────────────────────────────────

describe("aggregateExpensesReport", () => {
  const rows: ExpensesAggregateRow[] = [
    { shop_id: 1, created_at: "2026-03-10T08:00:00.000Z", total_kopecks: 75_50 },
    { shop_id: 1, created_at: "2026-03-10T20:00:00.000Z", total_kopecks: 24_50 },
    { shop_id: 1, created_at: "2026-03-12T11:00:00.000Z", total_kopecks: 200_00 },
  ];

  it("sums in rubles via fromKopecks", () => {
    const report = aggregateExpensesReport(rows, {});
    expect(report.total_amount).toBeCloseTo(300, 2);
    expect(report.count).toBe(3);
  });

  it("groups by day and respects the range", () => {
    const report = aggregateExpensesReport(rows, { dateFrom: "2026-03-10", dateTo: "2026-03-10" });
    expect(report.count).toBe(2);
    expect(report.data).toHaveLength(1);
    expect(report.data[0]).toEqual({ date: "2026-03-10", count: 2, amount: 100 });
  });

  it("emits empty data array when nothing matches", () => {
    const report = aggregateExpensesReport(rows, { dateFrom: "2027-01-01" });
    expect(report.count).toBe(0);
    expect(report.total_amount).toBe(0);
    expect(report.data).toEqual([]);
  });
});

// ─── Stock report ───────────────────────────────────────────────────────────

describe("aggregateStockReport", () => {
  const rows: ProductAggregateRow[] = [
    { id: "p1", name: "Hammer",  shop_id: 1, stock_quantity: 10, low_stock_alert: 5, cost_price_kopecks: 100_00, sale_price_kopecks: 150_00 },
    { id: "p2", name: "Nail",    shop_id: 1, stock_quantity: 3,  low_stock_alert: 5, cost_price_kopecks: 1_50,   sale_price_kopecks: 3_00 },
    { id: "p3", name: "Screw",   shop_id: 1, stock_quantity: 0,  low_stock_alert: 5, cost_price_kopecks: 2_00,   sale_price_kopecks: 4_00 },
    { id: "p4", name: "Tape",    shop_id: 1, stock_quantity: 50, low_stock_alert: 0, cost_price_kopecks: 50_00,  sale_price_kopecks: 75_00 },
  ];

  it("counts products and sums stock value at cost (in rubles)", () => {
    const report = aggregateStockReport(rows);
    expect(report.total_products).toBe(4);
    // 10*100 + 3*1.50 + 0*2 + 50*50 = 1000 + 4.50 + 0 + 2500 = 3504.50
    expect(report.total_value).toBeCloseTo(3504.5, 2);
  });

  it("flags low_stock when 0 < qty <= alert", () => {
    const report = aggregateStockReport(rows);
    expect(report.low_stock).toBe(1);  // p2 (qty=3 ≤ alert=5)
  });

  it("flags out_of_stock only when qty === 0 (qty 0 doesn't double-count as low)", () => {
    const report = aggregateStockReport(rows);
    expect(report.out_of_stock).toBe(1);  // p3
  });

  it("does not flag products without an alert threshold", () => {
    // p4 has qty=50, alert=0 → neither low nor out
    const report = aggregateStockReport([rows[3]]);
    expect(report.low_stock).toBe(0);
    expect(report.out_of_stock).toBe(0);
  });

  it("emits per-row entries with kopecks-converted sale_price + value", () => {
    const report = aggregateStockReport([rows[0]]);
    expect(report.data[0]).toEqual({
      id: "p1",
      name: "Hammer",
      stock_quantity: 10,
      sale_price: 150,
      value: 10 * 100,
    });
  });

  it("treats null kopecks columns as 0 (resilience against half-migrated rows)", () => {
    const report = aggregateStockReport([
      { id: "x", name: "Half-migrated", shop_id: null, stock_quantity: 5, low_stock_alert: null, cost_price_kopecks: null, sale_price_kopecks: null },
    ]);
    expect(report.data[0].value).toBe(0);
    expect(report.data[0].sale_price).toBe(0);
  });
});

// ─── Profit / COGS ──────────────────────────────────────────────────────────

describe("aggregateCostOfGoodsSold", () => {
  const range = { dateFrom: "2026-03-01", dateTo: "2026-03-31" };

  const saleRows: ProfitSaleRow[] = [
    { id: "sale-1", type: "product", shop_id: 1, created_at: "2026-03-15T10:00:00.000Z" }, // in range
    { id: "sale-2", type: "service", shop_id: 1, created_at: "2026-03-16T10:00:00.000Z" }, // service: skip
    { id: "sale-3", type: "product", shop_id: 1, created_at: "2026-04-01T10:00:00.000Z" }, // out of range
  ];

  const items: SaleItemAggregateRow[] = [
    { sale_id: "sale-1", product_id: "uuid-A", quantity: 2 },
    { sale_id: "sale-1", product_id: "uuid-B", quantity: 5 },
    { sale_id: "sale-2", product_id: "uuid-A", quantity: 99 }, // service sale — must be ignored
    { sale_id: "sale-3", product_id: "uuid-A", quantity: 7 },  // out of range — must be ignored
  ];

  // Cost map keyed by UUID strings — guards against the pre-5.8 bug where
  // products were keyed by `number` even though IDs are strings since v24.
  const productCostMap = new Map<string, number>([
    ["uuid-A", 50],
    ["uuid-B", 12],
  ]);

  it("sums cost*qty only for product-type sales inside the range", () => {
    // sale-1: 2*50 + 5*12 = 100 + 60 = 160
    expect(aggregateCostOfGoodsSold(saleRows, items, productCostMap, range)).toBe(160);
  });

  it("returns 0 when no product sales fall in range", () => {
    const out = { dateFrom: "2027-01-01" };
    expect(aggregateCostOfGoodsSold(saleRows, items, productCostMap, out)).toBe(0);
  });

  it("treats unknown product_id as cost=0 (safer than crashing on stale FK)", () => {
    const orphanItems: SaleItemAggregateRow[] = [
      { sale_id: "sale-1", product_id: "uuid-not-in-map", quantity: 99 },
    ];
    expect(aggregateCostOfGoodsSold(saleRows, orphanItems, productCostMap, range)).toBe(0);
  });

  it("ignores items with null product_id (services line items in product sales)", () => {
    const mixed: SaleItemAggregateRow[] = [
      { sale_id: "sale-1", product_id: null, quantity: 99 },
      { sale_id: "sale-1", product_id: "uuid-A", quantity: 1 },
    ];
    expect(aggregateCostOfGoodsSold(saleRows, mixed, productCostMap, range)).toBe(50);
  });
});

describe("aggregateProfitReport", () => {
  it("computes profit = sales_total - expenses_total - cogs", () => {
    const sales = aggregateSalesReport(
      [
        { id: "s1", type: "product", payment_type: "cash", shop_id: 1, created_at: "2026-03-10T10:00:00.000Z", total_kopecks: 1000_00 },
      ],
      {}
    );
    const expenses = aggregateExpensesReport(
      [{ shop_id: 1, created_at: "2026-03-10T11:00:00.000Z", total_kopecks: 200_00 }],
      {}
    );
    const profit = aggregateProfitReport(sales, expenses, /* totalCost */ 300, { dateFrom: "2026-03-01", dateTo: "2026-03-31" });

    expect(profit.total_sales).toBe(1000);
    expect(profit.total_expenses).toBe(200);
    expect(profit.total_cost).toBe(300);
    expect(profit.profit).toBe(500);
    expect(profit.date_from).toBe("2026-03-01");
    expect(profit.date_to).toBe("2026-03-31");
  });

  it("can produce negative profit (loss-making period must not be clamped)", () => {
    const sales = aggregateSalesReport([], {});
    const expenses = aggregateExpensesReport([{ shop_id: 1, created_at: "2026-03-10T11:00:00.000Z", total_kopecks: 500_00 }], {});
    const profit = aggregateProfitReport(sales, expenses, 0, {});
    expect(profit.profit).toBe(-500);
  });
});
