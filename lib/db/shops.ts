// ─── Shops repository ────────────────────────────────────────────────────────
//
// The shops table is unusual in that it carries BOTH a server `id` (number)
// and a `local_id` (string). Locally-created shops use `local_id` as their
// stable handle and a placeholder negative `id` until the server returns
// a real id; reads accept either via `getLocalShopById`.
//
// The split between `insertOrUpdateShop` (single, used by the SSO flow on
// login) and `insertOrUpdateShops` (batch, used by RemoteShopFetcher) is
// historical — both write the same row, but the singular path doesn't run
// in a transaction since it's called once per session.

import type { Shop } from "@/lib/api";
import { getDb } from "./schema";
import { queueSyncAction } from "./outbox";

interface ShopRow {
  id: number;
  local_id: string | null;
  name: string | null;
  is_active: number | null;
  sync_action: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_synced_at: string | null;
}

export interface LocalShop extends Shop {
  local_id: string;
  status: "pending" | "synced" | "failed";
  sync_action: "none" | "create" | "update" | "delete";
  last_synced_at?: string;
}

function mapRowToLocalShop(r: ShopRow): LocalShop {
  return {
    id: r.id,
    name: r.name ?? "",
    is_active: !!r.is_active,
    local_id: r.local_id ?? "",
    status: (r.status as LocalShop["status"]) ?? "pending",
    sync_action: (r.sync_action as LocalShop["sync_action"]) ?? "none",
    created_at: r.created_at ?? "",
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

export async function insertOrUpdateShop(shop: Shop, localId: string) {
  const db = getDb();

  const existing = await db.getFirstAsync<{ sync_action: string }>(
    "SELECT sync_action FROM shops WHERE id = ? OR local_id = ?",
    [shop.id, localId]
  );
  if (existing && existing.sync_action && existing.sync_action !== "none") {
    return;
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO shops (
      id, local_id, name, is_active,
      sync_action, status, created_at, updated_at, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      shop.id,
      localId,
      shop.name,
      shop.is_active ? 1 : 0,
      "none",
      "synced",
      shop.created_at || new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    ]
  );
}

/**
 * Batch upsert for delta-sync. Soft-deleted server records (deleted_at set)
 * are removed locally so the mobile catalogue stays consistent.
 */
export async function insertOrUpdateShops(shops: Array<Shop & { deleted_at?: string | null }>): Promise<void> {
  if (shops.length === 0) return;
  const db = getDb();

  await db.withTransactionAsync(async () => {
    for (const shop of shops) {
      if (shop.deleted_at) {
        await db.runAsync("DELETE FROM shops WHERE id = ?", [shop.id]);
        continue;
      }

      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM shops WHERE id = ?",
        [shop.id]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO shops (
          id, local_id, name, is_active,
          sync_action, status, created_at, updated_at, last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shop.id,
          String(shop.id),
          shop.name,
          shop.is_active ? 1 : 0,
          "none",
          "synced",
          shop.created_at || new Date().toISOString(),
          shop.updated_at || new Date().toISOString(),
          new Date().toISOString(),
        ]
      );
    }
  });
}

export async function insertOrUpdateLocalShop(
  shop: Partial<Shop> & { id: number; name: string; is_active: boolean },
  localId: string,
  syncAction: "create" | "update" | "delete" | "none"
) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO shops (
        id, local_id, name, is_active,
        sync_action, status, created_at, updated_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shop.id,
        localId,
        shop.name,
        shop.is_active ? 1 : 0,
        syncAction,
        "pending",
        new Date().toISOString(),
        new Date().toISOString(),
        null,
      ]
    );

    if (syncAction !== "none") {
      const method = syncAction === "create" ? "POST"
        : syncAction === "update" ? "PATCH"
        : "DELETE";
      const path = syncAction === "create" ? "/shops" : `/shops/${shop.id}`;
      await queueSyncAction(
        method,
        path,
        { name: shop.name, is_active: shop.is_active, _local_id: localId },
        { "Idempotency-Key": `local-shop-${localId}` },
        `local-shop-${localId}`
      );
    }
  });
}

export async function getLocalShops(): Promise<LocalShop[]> {
  const db = getDb();
  const results = await db.getAllAsync<ShopRow>("SELECT * FROM shops ORDER BY name ASC");
  return results.map(mapRowToLocalShop);
}

export async function getLocalShopById(localIdOrNegId: string): Promise<LocalShop | null> {
  const db = getDb();
  const r = await db.getFirstAsync<ShopRow>(
    "SELECT * FROM shops WHERE local_id = ? OR (id = ? AND id < 0)",
    [localIdOrNegId, localIdOrNegId]
  );
  if (!r) return null;
  return mapRowToLocalShop(r);
}

export async function updateShopStatus(localId: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE shops SET status = ?, sync_action = ? WHERE local_id = ?",
      [status, syncAction, localId]
    );
  } else {
    await db.runAsync(
      "UPDATE shops SET status = ? WHERE local_id = ?",
      [status, localId]
    );
  }
}

export async function deleteLocalShop(localId: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM shops WHERE local_id = ?", [localId]);
}

export async function getPendingSyncShops(): Promise<LocalShop[]> {
  const db = getDb();
  const results = await db.getAllAsync<ShopRow>(
    "SELECT * FROM shops WHERE sync_action != 'none' ORDER BY created_at ASC"
  );
  return results.map(mapRowToLocalShop);
}
