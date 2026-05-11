// ─── Purchases repository (online-first) ─────────────────────────────────────
//
// Read-only cache for the `purchases` table. The only writer is
// `insertOrUpdatePurchases`, called by the fetcher to mirror server rows.
// Purchases are owner-only on the backend; the local table has no user_id,
// scoping is by shop only.

import type { Purchase, PurchaseItem } from "@/lib/api";
import { getDb } from "./schema";
import { shopIdInClause, type LocalScope } from "./scope";
import { fromKopecks, toKopecks } from "./money";
import { invalidateAggregatedCaches } from "./cache";

interface PurchaseRow {
  id: string;
  shop_id: number | null;
  supplier_name: string | null;
  items: string | null;
  created_at: string | null;
  updated_at: string | null;
  total_kopecks: number | null;
}

export interface LocalPurchase extends Purchase {
  shop_id?: number;
  status?: "pending" | "synced" | "failed";
  sync_action?: "none" | "create" | "update" | "delete";
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
    status: "synced",
    sync_action: "none",
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
      await db.runAsync(
        `INSERT OR REPLACE INTO purchases (
          id, shop_id, supplier_name, items,
          created_at, updated_at,
          total_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id, shopId ?? null, p.supplier_name ?? null,
          JSON.stringify(p.items ?? []),
          p.created_at ?? "", p.updated_at ?? "",
          toKopecks(p.total),
        ]
      );
    }
  });
  await invalidateAggregatedCaches();
}

export async function getLocalPurchases(scope: LocalScope): Promise<LocalPurchase[]> {
  const db = getDb();
  let query = "SELECT * FROM purchases WHERE 1=1";
  const params: (string | number)[] = [];
  const shopFilter = shopIdInClause(scope.shopIds);
  query += shopFilter.sql;
  params.push(...shopFilter.params);
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<PurchaseRow>(query, params);
  return results.map(mapRowToLocalPurchase);
}
