// ─── Outbox failure handlers ────────────────────────────────────────────────
//
// 409 Conflict, 4xx permanent failure, 5xx transient failure. Each branch
// is short on its own; collapsing them here keeps the orchestrator focused
// on dispatch.

import {
  cancelPendingPurchaseStockDelta,
  cancelPendingStockDelta,
  markSyncActionStatus,
  type SyncAction,
} from "../../db";
import { detectConflict, queueExternalConflict } from "../ConflictContext";
import { entityTableForPath, safeQty } from "./helpers";

/**
 * Server says the local row is stale. Build a Conflict descriptor from
 * the request payload + server snapshot and enqueue it for the resolver
 * UI; mark the action `failed` (not retryable — user must resolve).
 */
export async function handleOutboxConflict(action: SyncAction, response: Response): Promise<void> {
  try {
    const responseData = await response.json().catch(() => ({}));
    const serverData = responseData?.server_data ?? responseData?.data ?? {};
    const reqPayload = JSON.parse(action.payload || "{}");
    const entityId = reqPayload.id ?? reqPayload._local_id ?? String(serverData.id ?? "");
    if (serverData && Object.keys(serverData).length > 0) {
      const table = entityTableForPath(action.path);
      const entityType = table === "sales" ? "sale"
        : table === "expenses" ? "expense"
        : table === "purchases" ? "purchase"
        : table === "debts" ? "debt"
        : "product";
      const conflict = detectConflict(entityId, entityType, reqPayload, serverData);
      if (conflict) {
        queueExternalConflict(conflict);
      }
    }
    await markSyncActionStatus(action.id, "failed", false, "Conflict detected");
  } catch {}
}

/**
 * 4xx (other than 409): permanent failure — validation, missing FK,
 * suspended shop, etc. Mark dead so the dead-letter UI can surface it,
 * and unwind any optimistic stock deltas the offline POST left behind.
 */
export async function handleOutboxClientError(action: SyncAction, response: Response): Promise<void> {
  const errBody = await response.json().catch(() => ({}));
  const errorMsg = `HTTP ${response.status}: ${errBody?.message ?? response.statusText ?? ""}`;
  await markSyncActionStatus(action.id, "dead", false, errorMsg);

  if (action.method === "POST" && (action.path === "/sales" || action.path === "/purchases")) {
    try {
      const reqPayload = JSON.parse(action.payload || "{}");
      if (!reqPayload.items) return;
      for (const item of reqPayload.items) {
        const qty = safeQty(item.quantity);
        if (item.product_id != null && qty !== null) {
          if (action.path === "/purchases") {
            await cancelPendingPurchaseStockDelta(item.product_id, qty);
          } else {
            await cancelPendingStockDelta(item.product_id, qty);
          }
        }
      }
    } catch {}
  }
}

/**
 * 5xx: transient — bump retries and let the next cycle pick it up.
 */
export async function handleOutboxServerError(action: SyncAction, response: Response): Promise<void> {
  const errBody = await response.json().catch(() => ({}));
  await markSyncActionStatus(action.id, "failed", true, `HTTP ${response.status}: ${errBody?.message ?? response.statusText ?? ""}`);
}
