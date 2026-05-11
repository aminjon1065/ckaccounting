// ─── Debts repository ────────────────────────────────────────────────────────
//
// CRUD over `debts` and `debt_transactions`. Bookkeeping is signed in the
// API layer (positive = receivable, negative = payable) but stored unsigned
// in kopecks alongside a `direction` column — the helpers below convert
// at the boundary using `signedDebtAmount` / `localDebtTransactionType`.
//
// `insertOrUpdate*` skips rows whose `sync_action` is anything other than
// `none`; that prevents a remote pull from clobbering an unsynced local
// edit. The same rule is applied to debt_transactions inside the same
// transaction so a partial overwrite can't split a debt from its history.

import type { Debt, DebtTransaction } from "@/lib/api";
import { getDb } from "./schema";
import type { LocalScope } from "./scope";
// debts.ts has its own shop filter (with the OR shop_id IS NULL broadening
// for offline-created rows) so it doesn't reuse `shopIdInClause` directly.
import {
  fromKopecks,
  localDebtTransactionType,
  signedDebtAmount,
  toKopecks,
} from "./money";
import { invalidateAggregatedCaches } from "./cache";

/**
 * Server pulls and merge inputs may carry `sync_action` (offline-first
 * metadata) on top of the canonical `Debt` shape. Threading it through
 * the input type keeps the local upsert path honest about that field
 * without polluting the public API contract.
 */
type DebtMergeInput = Debt & { sync_action?: string };

/** Raw shape returned by the `debts` SELECT — money is in kopecks (INTEGER). */
interface DebtRow {
  id: string;
  shop_id: number | null;
  user_id: number | null;
  created_by_name: string | null;
  person_name: string;
  direction: "receivable" | "payable" | null;
  version: number | null;
  updated_at: string;
  created_at: string | null;
  last_synced_at: string | null;
  opening_balance_kopecks: number | null;
  balance_kopecks: number | null;
  sync_action: string | null;
}

interface DebtTransactionRow {
  id: string;
  debt_id: string;
  type: "give" | "take" | "repay";
  note: string | null;
  created_by_name: string | null;
  created_at: string;
  amount_kopecks: number | null;
  sync_action: string | null;
}

export async function insertOrUpdateDebts(debts: DebtMergeInput[], shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const d of debts) {
      if (d.deleted_at) {
        await db.runAsync("DELETE FROM debts WHERE id = ?", [d.id]);
        continue;
      }

      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM debts WHERE id = ?",
        [d.id]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }

      const incomingSyncAction = d.sync_action ?? "none";
      const openingBalance = d.opening_balance ?? 0;
      await db.runAsync(
        `INSERT OR REPLACE INTO debts (
          id, shop_id, user_id, created_by_name, person_name, direction, version, updated_at, last_synced_at,
          opening_balance_kopecks, balance_kopecks, sync_action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.id, shopId ?? d.shop_id ?? null, d.user_id ?? null,
          d.created_by_name ?? null,
          d.person_name,
          d.direction ?? "receivable",
          d.version ?? 1,
          d.updated_at, new Date().toISOString(),
          toKopecks(openingBalance), toKopecks(d.balance), incomingSyncAction,
        ]
      );
      if (d.transactions) {
        for (const tx of d.transactions) {
          const existingTx = await db.getFirstAsync<{ sync_action: string }>(
            "SELECT sync_action FROM debt_transactions WHERE id = ?",
            [tx.id]
          );
          if (existingTx && existingTx.sync_action && existingTx.sync_action !== "none") {
            continue;
          }
          await db.runAsync(
            `INSERT OR REPLACE INTO debt_transactions (
              id, debt_id, type, note, created_by_name, created_at, amount_kopecks, sync_action
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              tx.id,
              tx.debt_id ?? d.id,
              localDebtTransactionType(tx.type, d.direction),
              tx.note ?? null,
              tx.created_by_name ?? null,
              tx.created_at,
              toKopecks(tx.amount),
              "none",
            ]
          );
        }
      }
    }
  });
  // debts_receivable / debts_payable / unpaid_debts on the dashboard depend
  // on this; without invalidation the offline view drifts after a remote
  // pull until the 5-min TTL expires.
  await invalidateAggregatedCaches();
}

export async function insertOrUpdateDebtTransactions(transactions: DebtTransaction[]) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const tx of transactions) {
      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM debt_transactions WHERE id = ?",
        [tx.id]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO debt_transactions (
          id, debt_id, type, note, created_by_name, created_at, amount_kopecks, sync_action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.id, tx.debt_id, tx.type, tx.note ?? null,
          tx.created_by_name ?? null,
          tx.created_at, toKopecks(tx.amount), "none",
        ]
      );
    }
  });
  // recent_debt_transactions widget on the dashboard depends on these.
  await invalidateAggregatedCaches();
}

export async function getLocalDebts(scope: LocalScope): Promise<Debt[]> {
  const db = getDb();
  let query = "SELECT * FROM debts";
  const params: any[] = [];
  const conditions: string[] = [];
  if (scope.shopIds !== null) {
    if (scope.shopIds.length === 0) {
      // Empty owner / seller scope — no rows.
      conditions.push("0 = 1");
    } else {
      // shop_id IS NULL covers debts created offline before the row knew
      // which shop it belonged to — they get attributed to the active
      // scope on next sync. Broadening is intentional for that transient
      // state only.
      const placeholders = scope.shopIds.map(() => "?").join(",");
      conditions.push(`(shop_id IN (${placeholders}) OR shop_id IS NULL)`);
      params.push(...scope.shopIds);
    }
  }
  if (scope.userId !== null) {
    conditions.push("user_id = ?");
    params.push(scope.userId);
  }
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY updated_at DESC";

  const results = await db.getAllAsync<DebtRow>(query, params);
  return results.map((r) => ({
    id: r.id,
    user_id: r.user_id ?? undefined,
    created_by_name: r.created_by_name,
    person_name: r.person_name,
    opening_balance: signedDebtAmount(
      fromKopecks(r.opening_balance_kopecks),
      r.direction
    ),
    balance: signedDebtAmount(
      fromKopecks(r.balance_kopecks),
      r.direction
    ),
    direction: r.direction ?? "receivable",
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
  }));
}

export async function getLocalDebtById(id: string): Promise<Debt | null> {
  const db = getDb();
  const r = await db.getFirstAsync<DebtRow>(
    "SELECT * FROM debts WHERE id = ?",
    [id]
  );
  if (!r) return null;

  const txs = await getLocalDebtTransactions(r.id);
  return {
    id: r.id,
    created_by_name: r.created_by_name,
    person_name: r.person_name,
    opening_balance: signedDebtAmount(
      fromKopecks(r.opening_balance_kopecks),
      r.direction
    ),
    balance: signedDebtAmount(
      fromKopecks(r.balance_kopecks),
      r.direction
    ),
    direction: r.direction ?? "receivable",
    transactions: txs,
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
  };
}

/**
 * Drop a debt and its transactions from the local cache. Used when the server
 * reports the debt no longer exists (404 on a write) so the next read doesn't
 * resurrect a ghost row.
 */
export async function deleteLocalDebt(id: string): Promise<void> {
  if (!id) return;
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM debt_transactions WHERE debt_id = ?", [id]);
    await db.runAsync("DELETE FROM debts WHERE id = ?", [id]);
  });
  invalidateAggregatedCaches();
}

export async function getLocalDebtTransactions(debt_id: string): Promise<DebtTransaction[]> {
  const db = getDb();
  const results = await db.getAllAsync<DebtTransactionRow>(
    "SELECT * FROM debt_transactions WHERE debt_id = ? ORDER BY created_at DESC",
    [debt_id]
  );
  return results.map((r) => ({
    id: r.id,
    debt_id: r.debt_id,
    type: r.type,
    amount: fromKopecks(r.amount_kopecks),
    note: r.note,
    created_by_name: r.created_by_name,
    created_at: r.created_at,
  }));
}
