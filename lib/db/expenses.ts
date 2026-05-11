// ─── Expenses repository (online-first) ──────────────────────────────────────
//
// Read-only cache for the `expenses` table. The only writer is
// `insertOrUpdateExpenses`, called by the expenses fetcher to mirror server
// rows into SQLite. Expenses are owner-only on the backend; the read path
// keeps the userId filter as defense-in-depth.

import type { Expense } from "@/lib/api";
import { getDb } from "./schema";
import { shopIdInClause, type LocalScope } from "./scope";
import { fromKopecks, toKopecks } from "./money";
import { invalidateAggregatedCaches } from "./cache";

interface ExpenseRow {
  id: string;
  shop_id: number | null;
  user_id: number | null;
  name: string;
  quantity: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  price_kopecks: number | null;
  total_kopecks: number | null;
}

export interface LocalExpense extends Expense {
  shop_id?: number;
  user_id?: number;
  status?: "pending" | "synced" | "failed";
  sync_action?: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

function mapRowToExpense(r: ExpenseRow): Expense {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity ?? 0,
    price: fromKopecks(r.price_kopecks),
    total: fromKopecks(r.total_kopecks),
    note: r.note,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function mapRowToLocalExpense(r: ExpenseRow): LocalExpense {
  const base = mapRowToExpense(r);
  return {
    ...base,
    shop_id: r.shop_id ?? undefined,
    user_id: r.user_id ?? undefined,
    status: "synced",
    sync_action: "none",
  };
}

export async function getLocalExpenses(scope: LocalScope): Promise<LocalExpense[]> {
  const db = getDb();
  let query = "SELECT * FROM expenses WHERE 1=1";
  const params: (string | number)[] = [];
  const shopFilter = shopIdInClause(scope.shopIds);
  query += shopFilter.sql;
  params.push(...shopFilter.params);
  if (scope.userId !== null) {
    query += " AND user_id = ?";
    params.push(scope.userId);
  }
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<ExpenseRow>(query, params);
  return results.map(mapRowToLocalExpense);
}

/**
 * Drop an expense from the local cache. Used after a 404 on a write to
 * evict the ghost row.
 */
export async function deleteLocalExpense(id: string | number): Promise<void> {
  if (id === null || id === undefined || id === "") return;
  const db = getDb();
  await db.runAsync("DELETE FROM expenses WHERE id = ?", [id]);
  await invalidateAggregatedCaches();
}

export async function insertOrUpdateExpenses(expenses: Expense[], shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const e of expenses) {
      if (e.deleted_at) {
        await db.runAsync("DELETE FROM expenses WHERE id = ?", [e.id]);
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO expenses (
          id, shop_id, user_id, name, quantity, note,
          created_at, updated_at,
          price_kopecks, total_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id, shopId ?? null, null, e.name, e.quantity,
          e.note ?? null,
          e.created_at, e.updated_at,
          toKopecks(e.price), toKopecks(e.total),
        ]
      );
    }
  });
  await invalidateAggregatedCaches();
}
