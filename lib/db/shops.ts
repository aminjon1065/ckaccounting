// ─── Shops repository (online-first) ─────────────────────────────────────────
//
// Read-only cache for the `shops` table. The only writer is
// `insertOrUpdateShops` (batch), called by the fetcher.
//
// Pre-migration the table had a `local_id` column for offline-created shops
// (negative `id` placeholder until the server returned a real one); after
// migration v31 those columns are gone and every shop carries a real server
// id. The `local_id` field on `LocalShop` is retained on the TYPE for
// backward-compat with any caller that still reads it, but it's no longer
// stored or surfaced from SQLite.

import type { Shop } from "@/lib/api";
import { getDb } from "./schema";

interface ShopRow {
  id: number;
  name: string | null;
  is_active: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface LocalShop extends Shop {
  /** @deprecated kept on type for backward-compat; no longer populated. */
  local_id?: string;
  status?: "pending" | "synced" | "failed";
  sync_action?: "none" | "create" | "update" | "delete";
  last_synced_at?: string;
}

function mapRowToLocalShop(r: ShopRow): LocalShop {
  return {
    id: r.id,
    name: r.name ?? "",
    is_active: !!r.is_active,
    created_at: r.created_at ?? "",
    status: "synced",
    sync_action: "none",
  };
}

export async function insertOrUpdateShops(shops: Array<Shop & { deleted_at?: string | null }>): Promise<void> {
  if (shops.length === 0) return;
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const shop of shops) {
      if (shop.deleted_at) {
        await db.runAsync("DELETE FROM shops WHERE id = ?", [shop.id]);
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO shops (
          id, name, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          shop.id,
          shop.name,
          shop.is_active ? 1 : 0,
          shop.created_at || new Date().toISOString(),
          shop.updated_at || new Date().toISOString(),
        ]
      );
    }
  });
}

export async function getLocalShops(): Promise<LocalShop[]> {
  const db = getDb();
  const results = await db.getAllAsync<ShopRow>("SELECT * FROM shops ORDER BY name ASC");
  return results.map(mapRowToLocalShop);
}

export async function getLocalShopById(id: string | number): Promise<LocalShop | null> {
  const db = getDb();
  const numeric = typeof id === "string" ? Number(id) : id;
  if (!Number.isFinite(numeric)) return null;
  const r = await db.getFirstAsync<ShopRow>("SELECT * FROM shops WHERE id = ?", [numeric]);
  if (!r) return null;
  return mapRowToLocalShop(r);
}

export async function deleteLocalShop(id: number): Promise<void> {
  if (!Number.isFinite(id)) return;
  const db = getDb();
  await db.runAsync("DELETE FROM shops WHERE id = ?", [id]);
}

/**
 * Replace the local shops cache with the authoritative server set: keep rows
 * whose id appears in `serverIds`, drop the rest. Used after a full pull to
 * evict ghosts (rows hard-deleted on the server, where soft-delete tombstones
 * never reach the delta sync).
 */
export async function reconcileLocalShops(serverIds: number[]): Promise<void> {
  const db = getDb();
  if (serverIds.length === 0) {
    await db.runAsync("DELETE FROM shops");
    return;
  }
  const placeholders = serverIds.map(() => "?").join(",");
  await db.runAsync(`DELETE FROM shops WHERE id NOT IN (${placeholders})`, serverIds);
}
