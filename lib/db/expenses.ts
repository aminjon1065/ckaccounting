// ─── Expenses repository ─────────────────────────────────────────────────────
//
// Expenses are owner-only on the backend (ExpensePolicy::viewAny gates by
// the row's user_id), so the local read path scopes by both shop_id AND
// user_id. The seller scope effectively returns nothing — that's intentional;
// we still honor userId as defense-in-depth in case the policy ever opens up.
//
// `markExpenseDeletedLocally` mirrors the same pattern used by
// `markProductDeletedLocally` in products.ts: if the row has never reached
// the server (sync_action='create'), we drop the original POST and the
// row in one go; otherwise we queue a DELETE.

import type { Expense } from "@/lib/api";
import { getDb } from "./schema";
import { shopIdInClause, type LocalScope } from "./scope";
import { fromKopecks, toKopecks } from "./money";
import { invalidateAggregatedCaches } from "./cache";
import { queueSyncAction } from "./outbox";

interface ExpenseRow {
  id: string;
  shop_id: number | null;
  user_id: number | null;
  name: string;
  quantity: number | null;
  price: number | null;
  total: number | null;
  note: string | null;
  status: string;
  sync_action: string;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  price_kopecks: number | null;
  total_kopecks: number | null;
}

export interface LocalExpense extends Expense {
  shop_id?: number;
  user_id?: number;
  status: "pending" | "synced" | "failed";
  sync_action: "none" | "create" | "update" | "delete";
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
    status: r.status as LocalExpense["status"],
    sync_action: r.sync_action as LocalExpense["sync_action"],
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

// expense.id must be a UUID generated client-side before calling this.
export async function insertOrUpdateExpense(
  expense: Expense,
  shopId?: number,
  userId?: number,
  syncAction: "create" | "update" | "none" = "create"
) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO expenses (
        id, shop_id, user_id, name, quantity, note,
        status, sync_action, created_at, updated_at, last_synced_at,
        price_kopecks, total_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expense.id,
        shopId ?? null,
        userId ?? null,
        expense.name,
        expense.quantity,
        expense.note ?? null,
        "pending",
        syncAction,
        expense.created_at ?? now,
        expense.updated_at ?? now,
        null,
        toKopecks(expense.price), toKopecks(expense.total),
      ]
    );

    if (syncAction === "create") {
      await queueSyncAction(
        "POST",
        "/expenses",
        {
          id: expense.id,
          name: expense.name,
          quantity: expense.quantity,
          price: expense.price,
          note: expense.note,
          shop_id: shopId,
        },
        { "Idempotency-Key": `exp-${expense.id}` },
        `exp-${expense.id}`
      );
    } else if (syncAction === "update") {
      const patchPayload: Record<string, unknown> = {
        name: expense.name,
        quantity: expense.quantity,
        price: expense.price,
        note: expense.note,
        shop_id: shopId,
      };
      if (expense.version !== undefined) {
        patchPayload.version = expense.version;
      }
      await queueSyncAction(
        "PATCH",
        `/expenses/${expense.id}`,
        patchPayload,
        undefined,
        `exp-update-${expense.id}`
      );
    }

    await invalidateAggregatedCaches();
  });
}

export async function getLocalExpenses(scope: LocalScope): Promise<LocalExpense[]> {
  const db = getDb();
  let query = "SELECT * FROM expenses WHERE (sync_action IS NULL OR sync_action != 'delete')";
  const params: any[] = [];
  const shopFilter = shopIdInClause(scope.shopIds);
  query += shopFilter.sql;
  params.push(...shopFilter.params);
  // Owner-only on the backend, so seller scope effectively returns nothing.
  // userId stays in the WHERE as defense-in-depth.
  if (scope.userId !== null) {
    query += " AND user_id = ?";
    params.push(scope.userId);
  }
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<ExpenseRow>(query, params);
  return results.map(mapRowToLocalExpense);
}

export async function updateExpenseStatus(id: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE expenses SET status = ?, sync_action = ? WHERE id = ?",
      [status, syncAction, id]
    );
  } else {
    await db.runAsync(
      "UPDATE expenses SET status = ? WHERE id = ?",
      [status, id]
    );
  }
}

export async function deleteLocalExpense(id: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM expenses WHERE id = ?", [id]);
}

export async function getPendingSyncExpenses(): Promise<LocalExpense[]> {
  const db = getDb();
  const results = await db.getAllAsync<ExpenseRow>(
    "SELECT * FROM expenses WHERE sync_action != 'none' ORDER BY created_at ASC"
  );
  return results.map(mapRowToLocalExpense);
}

export async function insertOrUpdateExpenses(expenses: Expense[], shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const e of expenses) {
      if (e.deleted_at) {
        await db.runAsync(
          `UPDATE expenses SET sync_action = 'delete', status = 'synced', updated_at = ?
           WHERE id = ?`,
          [new Date().toISOString(), e.id]
        );
        continue;
      }

      const existing = await db.getFirstAsync<{ sync_action: string; status: string }>(
        "SELECT sync_action, status FROM expenses WHERE id = ?",
        [e.id]
      );
      if (existing?.sync_action === 'delete' && existing?.status === 'synced') {
        continue;
      }
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO expenses (
          id, shop_id, user_id, name, quantity, note,
          status, sync_action, version, created_at, updated_at, last_synced_at,
          price_kopecks, total_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id, shopId ?? null, null, e.name, e.quantity,
          e.note ?? null, "synced", "none",
          e.version ?? 1,
          e.created_at, e.updated_at, new Date().toISOString(),
          toKopecks(e.price), toKopecks(e.total),
        ]
      );
    }
  });
  // period_expenses_total + recent_expenses widgets depend on this.
  await invalidateAggregatedCaches();
}

/**
 * Mark an expense as deleted locally and queue the DELETE for sync.
 * Mirrors `markProductDeletedLocally` — if the row has never been synced
 * (sync_action='create'), we drop the queued POST and the local row at
 * once instead of queuing a DELETE for an id the server has never seen.
 */
export async function markExpenseDeletedLocally(expenseId: string): Promise<void> {
  const db = getDb();

  const existing = await db.getFirstAsync<{ sync_action: string; version: number | null }>(
    "SELECT sync_action, version FROM expenses WHERE id = ?",
    [expenseId]
  );

  if (existing?.sync_action === "create") {
    await db.runAsync("DELETE FROM sync_queue WHERE idempotency_key = ?", [`exp-${expenseId}`]);
    await db.runAsync("DELETE FROM expenses WHERE id = ?", [expenseId]);
  } else {
    await db.runAsync(
      "UPDATE expenses SET status = 'pending', sync_action = 'delete' WHERE id = ?",
      [expenseId]
    );
    const idempKey = `exp-delete-${expenseId}`;
    await queueSyncAction(
      "DELETE",
      `/expenses/${expenseId}`,
      { version: existing?.version ?? 1 },
      { "Idempotency-Key": idempKey },
      idempKey
    );
  }
}
