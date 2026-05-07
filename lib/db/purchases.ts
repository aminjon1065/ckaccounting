// ─── Purchases repository ────────────────────────────────────────────────────
//
// Purchases (supplier deliveries) are owner-only on the backend
// (PurchasePolicy::viewAny gates by shop ownership), and the local table
// doesn't carry a user_id column — scope.userId is intentionally ignored
// in the read path because sellers shouldn't be reaching it. Defense lives
// at the policy layer.
//
// `insertOrUpdatePurchase` (singular, local-create path) optimistically
// bumps `products.stock_quantity` and `products.pending_stock_delta`. The
// outbox sweeper / 4xx rollback in OutboxProcessor / `cancelPendingPurchase
// StockDelta` in products.ts is the matching unwind path. See
// `lib/db/products.ts` for the recovery details.

import type { Purchase, PurchaseItem } from "@/lib/api";
import { getDb } from "./schema";
import { shopIdInClause, type LocalScope } from "./scope";
import { fromKopecks, toKopecks } from "./money";
import { invalidateAggregatedCaches } from "./cache";
import { queueSyncAction } from "./outbox";

interface PurchaseRow {
  id: string;
  shop_id: number | null;
  supplier_name: string | null;
  total: number | null;
  items: string | null;
  status: string | null;
  sync_action: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_synced_at: string | null;
  total_kopecks: number | null;
}

export interface LocalPurchase extends Purchase {
  shop_id?: number;
  status: "pending" | "synced" | "failed";
  sync_action: "none" | "create" | "update" | "delete";
  last_synced_at?: string;
}

function mapRowToPurchase(r: PurchaseRow): Purchase {
  let items: PurchaseItem[] = [];
  try {
    items = JSON.parse(r.items || "[]");
  } catch {}
  return {
    id: r.id,
    supplier_name: r.supplier_name ?? null,
    total: fromKopecks(r.total_kopecks),
    items,
    created_at: r.created_at ?? "",
    updated_at: r.updated_at ?? "",
  };
}

function mapRowToLocalPurchase(r: PurchaseRow): LocalPurchase {
  const base = mapRowToPurchase(r);
  return {
    ...base,
    shop_id: r.shop_id ?? undefined,
    status: (r.status as LocalPurchase["status"]) ?? "pending",
    sync_action: (r.sync_action as LocalPurchase["sync_action"]) ?? "none",
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

export async function insertOrUpdatePurchases(purchases: Purchase[], shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const p of purchases) {
      if (p.deleted_at) {
        await db.runAsync("DELETE FROM purchases WHERE id = ?", [p.id]);
        continue;
      }

      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM purchases WHERE id = ?",
        [p.id]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO purchases (
          id, shop_id, supplier_name, items,
          status, sync_action, created_at, updated_at, last_synced_at,
          total_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id, shopId ?? null, p.supplier_name ?? null,
          JSON.stringify(p.items ?? []),
          "synced", "none", p.created_at ?? "", p.updated_at ?? "", new Date().toISOString(),
          toKopecks(p.total),
        ]
      );
    }
  });
  // Purchases don't appear directly on the dashboard, but they shift stock
  // and feed reports — both surfaces share the same cache pool, so blow it.
  await invalidateAggregatedCaches();
}

// purchase.id must be a UUID generated client-side before calling this.
export async function insertOrUpdatePurchase(purchase: Purchase, shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO purchases (
        id, shop_id, supplier_name, items,
        status, sync_action, created_at, updated_at, last_synced_at,
        total_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        purchase.id,
        shopId ?? null,
        purchase.supplier_name ?? null,
        JSON.stringify(purchase.items ?? []),
        "pending",
        "create",
        purchase.created_at || new Date().toISOString(),
        purchase.updated_at || new Date().toISOString(),
        null,
        toKopecks(purchase.total),
      ]
    );

    await queueSyncAction(
      "POST",
      "/purchases",
      {
        id: purchase.id,
        supplier_name: purchase.supplier_name,
        items: purchase.items,
        shop_id: shopId,
      },
      { "Idempotency-Key": `pur-${purchase.id}` },
      `pur-${purchase.id}`
    );

    for (const item of purchase.items ?? []) {
      await db.runAsync(
        "UPDATE products SET stock_quantity = stock_quantity + ?, pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
        [item.quantity, item.quantity, item.product_id]
      );
    }

    await invalidateAggregatedCaches();
  });
}

export async function getLocalPurchases(scope: LocalScope): Promise<LocalPurchase[]> {
  const db = getDb();
  let query = "SELECT * FROM purchases WHERE (sync_action IS NULL OR sync_action != 'delete')";
  const params: any[] = [];
  const shopFilter = shopIdInClause(scope.shopIds);
  query += shopFilter.sql;
  params.push(...shopFilter.params);
  // Owner-only on the backend; local table has no user_id, so scope.userId
  // is intentionally ignored here. Defense lives at the policy layer.
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<PurchaseRow>(query, params);
  return results.map(mapRowToLocalPurchase);
}

export async function updatePurchaseStatus(id: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE purchases SET status = ?, sync_action = ? WHERE id = ?",
      [status, syncAction, id]
    );
  } else {
    await db.runAsync(
      "UPDATE purchases SET status = ? WHERE id = ?",
      [status, id]
    );
  }
}

export async function deleteLocalPurchase(id: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM purchases WHERE id = ?", [id]);
}

export async function getPendingSyncPurchases(): Promise<LocalPurchase[]> {
  const db = getDb();
  const results = await db.getAllAsync<PurchaseRow>(
    "SELECT * FROM purchases WHERE sync_action != 'none' ORDER BY created_at ASC"
  );
  return results.map(mapRowToLocalPurchase);
}
