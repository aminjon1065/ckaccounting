// ─── Outbox 2xx handler ─────────────────────────────────────────────────────
//
// What the processor must do after a successful HTTP response:
//
//  1. Shop ID remap — shops use auto-increment INTEGER ids (not UUIDs),
//     so the offline POST temporarily picks a negative id and the server
//     hands back the real one. We rewrite the local row + any queued
//     PATCH/DELETE actions still pointing at the temp id, otherwise they
//     would 404 on replay.
//
//  2. Stock delta resolution — sale/purchase POSTs optimistically bumped
//     `pending_stock_delta`; when the server confirms, drain those deltas
//     so the offline-stock view stops double-counting.
//
//  3. Version writeback — persist the server's `version` so the next
//     PATCH ships with the fresh baseline; without this, every second
//     edit in a row would 409 against optimistic locking.
//
//  4. DELETE confirmation — flip the local tombstone to `synced` so it
//     stops showing up in the UI's "pending sync" hints.
//
// Returns an outcome string the caller maps to a sync_queue status.

import {
  getDb,
  markSyncActionStatus,
  onPurchaseSyncSuccess,
  onSaleSyncSuccess,
  type SyncAction,
} from "../../db";
import { reportError } from "@/lib/observability/reporter";
import { entityTableForPath, extractServerEntity, safeQty } from "./helpers";

export async function handleOutboxSuccess(action: SyncAction, response: Response): Promise<void> {
  // Parse response once — we need it for both shop ID remap and version writeback.
  let parsedBody: unknown = null;
  try {
    parsedBody = await response.clone().json();
  } catch {
    parsedBody = null;
  }
  const serverEntity = extractServerEntity(parsedBody);
  const serverVersion =
    typeof (serverEntity as { version?: unknown })?.version === "number"
      ? (serverEntity as { version: number }).version
      : null;

  if (action.method === "POST" && action.path === "/shops") {
    await remapShopId(action, serverEntity);
  }

  if (action.method === "POST" && (action.path === "/sales" || action.path === "/purchases")) {
    await drainStockDeltasOnSuccess(action);
  }

  try {
    const reqPayload = JSON.parse(action.payload || "{}");
    // With UUIDs the client sends id= in the payload; server stores the same UUID.
    // No ID remapping is needed for non-shop tables — just mark the row synced.
    const entityId = reqPayload.id as string | undefined;
    const now = new Date().toISOString();

    if (action.method !== "DELETE" && entityId) {
      await writebackVersion(action, entityId, serverVersion, now);
    }

    if (action.method === "DELETE") {
      const deleteTable = entityTableForPath(action.path);
      const lastSegment = action.path.split("/").filter(Boolean).pop();
      if (deleteTable && lastSegment) {
        await getDb().runAsync(
          `UPDATE ${deleteTable} SET sync_action = 'delete', status = 'synced' WHERE id = ?`,
          [lastSegment]
        );
      }
    }
  } catch (e) {
    reportError(e, {
      tag: "outbox-local-side-effects",
      actionId: action.id,
      method: action.method,
      path: action.path,
    });
    await markSyncActionStatus(action.id, "failed", true, "Local side effects failed after server write");
    return;
  }

  await markSyncActionStatus(action.id, "completed");
}

async function remapShopId(action: SyncAction, serverEntity: Record<string, unknown> | null): Promise<void> {
  try {
    const reqPayload = JSON.parse(action.payload || "{}");
    const localId = reqPayload._local_id as string | undefined;
    if (!localId) return;

    const newId = (serverEntity as { id?: number } | null)?.id;
    if (typeof newId !== "number" || !Number.isFinite(newId)) return;

    const db = getDb();
    const oldRow = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM shops WHERE local_id = ?",
      [localId]
    );
    await db.runAsync(
      "UPDATE shops SET id = ?, sync_action = 'none', status = 'synced', last_synced_at = ? WHERE local_id = ?",
      [newId, new Date().toISOString(), localId]
    );
    if (oldRow && oldRow.id !== newId) {
      // Re-target queued PATCH/DELETE actions that still point at the temp
      // negative id so they don't 404 when replayed.
      await db.runAsync(
        "UPDATE sync_queue SET path = ? WHERE path = ? AND archived_at IS NULL AND status IN ('pending','processing')",
        [`/shops/${newId}`, `/shops/${oldRow.id}`]
      );
    }
  } catch (e) {
    reportError(e, { tag: "outbox-remap-shop-id", actionId: action.id });
  }
}

async function drainStockDeltasOnSuccess(action: SyncAction): Promise<void> {
  try {
    const reqPayload = JSON.parse(action.payload || "{}");
    if (!reqPayload.items) return;
    for (const item of reqPayload.items) {
      const qty = safeQty(item.quantity);
      if (item.product_id != null && qty !== null) {
        if (action.path === "/purchases") {
          await onPurchaseSyncSuccess(item.product_id, qty);
        } else {
          await onSaleSyncSuccess(item.product_id, qty);
        }
      }
    }
  } catch {}
}

async function writebackVersion(
  action: SyncAction,
  entityId: string,
  serverVersion: number | null,
  now: string
): Promise<void> {
  const table = entityTableForPath(action.path);
  if (!table || table === "shops") return;

  if (table === "debt_transactions") {
    await getDb().runAsync(
      "UPDATE debt_transactions SET sync_action = 'none' WHERE id = ?",
      [entityId]
    );
    // The transaction itself has no version; bump the parent debt's
    // version from the response so the next outbox PATCH ships with
    // the fresh baseline.
    if (serverVersion !== null) {
      const debtUuid = action.path.match(/\/debts\/([^/]+)\/transactions$/)?.[1];
      if (debtUuid) {
        await getDb().runAsync(
          "UPDATE debts SET version = ?, last_synced_at = ? WHERE id = ?",
          [serverVersion, now, debtUuid]
        );
      }
    }
    return;
  }

  // Persist the server-returned version so subsequent edits ship with the
  // fresh baseline. Without this, every second edit in a row would 409.
  if (serverVersion !== null) {
    await getDb().runAsync(
      `UPDATE ${table} SET status = 'synced', sync_action = 'none', version = ?, last_synced_at = ? WHERE id = ?`,
      [serverVersion, now, entityId]
    );
  } else {
    await getDb().runAsync(
      `UPDATE ${table} SET status = 'synced', sync_action = 'none', last_synced_at = ? WHERE id = ?`,
      [now, entityId]
    );
  }
}
