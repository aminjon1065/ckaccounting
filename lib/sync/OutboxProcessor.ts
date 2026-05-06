import { API_URL } from "@/constants/config";
import {
  claimPendingSyncActions,
  getDb,
  markSyncActionStatus,
  onSaleSyncSuccess,
  onPurchaseSyncSuccess,
  cancelPendingStockDelta,
  cancelPendingPurchaseStockDelta,
  getPendingSyncActionsCount,
  getDeadSyncActionsCount,
  getPendingSyncActions,
  type SyncAction,
} from "../db";
import { detectConflict, queueExternalConflict } from "./ConflictContext";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Return quantity as a safe positive finite number, or null if invalid. */
function safeQty(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function entityTableForPath(path: string): string | null {
  if (/\/debts\/[^/]+\/transactions/.test(path)) return "debt_transactions";
  if (path.includes("/sales")) return "sales";
  if (path.includes("/products")) return "products";
  if (path.includes("/expenses")) return "expenses";
  if (path.includes("/purchases")) return "purchases";
  if (path.includes("/shops")) return "shops";
  if (path.includes("/debts")) return "debts";
  return null;
}

function stripClientMeta(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !key.startsWith("_"))
  );
}

// ─── OutboxProcessor ───────────────────────────────────────────────────────────

export interface OutboxCallbacks {
  onComplete?: () => void;
}

export class OutboxProcessor {
  /**
   * Process a single sync action: HTTP replay + DB updates + sale callbacks.
   */
  async processAction(action: SyncAction, authToken: string): Promise<void> {
    try {
      await markSyncActionStatus(action.id, "processing");

      const baseHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
        "Accept": "application/json",
      };

      let customHeaders: Record<string, string> = {};
      try {
        if (action.headers) customHeaders = JSON.parse(action.headers);
      } catch {}

      if (action.idempotency_key && !customHeaders["Idempotency-Key"]) {
        customHeaders["Idempotency-Key"] = action.idempotency_key;
      }

      const requestUrl = action.path.startsWith("http")
        ? action.path
        : `${API_URL}${action.path.startsWith("/") ? action.path : `/${action.path}`}`;

      let fetchOptions: RequestInit = {
        method: action.method,
        headers: { ...baseHeaders, ...customHeaders },
      };

      let requestPayload: Record<string, unknown> = {};
      try {
        requestPayload = action.payload ? JSON.parse(action.payload) : {};
      } catch {}

      if (action.method === "POST" && action.path === "/debts") {
        const openingBalance = Number(requestPayload.opening_balance ?? 0);
        if (Number.isFinite(openingBalance) && openingBalance < 0) {
          requestPayload.direction = "payable";
          requestPayload.opening_balance = Math.abs(openingBalance);
        }
      }

      // Fix direction for payable debt transactions before sending to server
      if (action.method === "POST" && /\/debts\/[^/]+\/transactions$/.test(action.path)) {
        try {
          const debtUuid = action.path.match(/\/debts\/([^/]+)\/transactions$/)?.[1];
          const debt = await getDb().getFirstAsync<{ direction: string | null; balance: number | null; balance_kopecks: number | null }>(
            "SELECT direction, balance, balance_kopecks FROM debts WHERE id = ?",
            [debtUuid ?? ""]
          );
          const rawBalance = debt?.balance_kopecks != null
            ? debt.balance_kopecks / 100
            : Number(debt?.balance ?? 0);
          const isPayable = debt?.direction === "payable" || rawBalance < 0;
          if (isPayable && requestPayload.type === "take") {
            requestPayload.type = "give";
          }
        } catch {}
      }

      const serverPayload = stripClientMeta(requestPayload);

      try {
        if (requestPayload.photo_uri) {
          const formData = new FormData();
          formData.append("image", {
            uri: requestPayload.photo_uri,
            type: "image/jpeg",
            name: "photo.jpg",
          } as any);
          fetchOptions.body = formData as any;
          delete (fetchOptions.headers as Record<string, string>)["Content-Type"];
        } else {
          fetchOptions.body = Object.keys(serverPayload).length > 0
            ? JSON.stringify(serverPayload)
            : action.payload;
        }
      } catch {
        fetchOptions.body = action.payload;
      }

      const response = await fetch(requestUrl, fetchOptions);

      if (response.ok) {
        // Shops use integer auto-increment IDs (not UUIDs), so the id-remap
        // has to happen explicitly here: read the server response to get the
        // assigned id and rewrite the local row + any queued actions that
        // still target the old temporary negative id.
        if (action.method === "POST" && action.path === "/shops") {
          try {
            const reqPayload = JSON.parse(action.payload || "{}");
            const localId = reqPayload._local_id as string | undefined;
            if (localId) {
              const responseBody = await response.clone().json().catch(() => null) as { id?: number } | null;
              const newId = responseBody?.id;
              if (typeof newId === "number" && Number.isFinite(newId)) {
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
                  // Re-target queued PATCH/DELETE actions that still point to
                  // the temp negative id so they don't 404 when replayed.
                  await db.runAsync(
                    "UPDATE sync_queue SET path = ? WHERE path = ? AND archived_at IS NULL AND status IN ('pending','processing')",
                    [`/shops/${newId}`, `/shops/${oldRow.id}`]
                  );
                }
              }
            }
          } catch (e) {
            console.error("Failed to remap local shop id after sync", e);
          }
        }

        // Resolve pending stock deltas for synced sales/purchases
        if (action.method === "POST" && (action.path === "/sales" || action.path === "/purchases")) {
          try {
            const reqPayload = JSON.parse(action.payload || "{}");
            if (reqPayload.items) {
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
            }
          } catch {}
        }

        try {
          const reqPayload = JSON.parse(action.payload || "{}");
          // With UUIDs the client sends id= in the payload; server stores that same UUID.
          // No ID remapping is needed — just mark the local row as synced.
          const entityId = reqPayload.id as string | undefined;
          const now = new Date().toISOString();

          if (action.method !== "DELETE" && entityId) {
            const table = entityTableForPath(action.path);
            if (table && table !== "shops") {
              if (table === "debt_transactions") {
                await getDb().runAsync(
                  "UPDATE debt_transactions SET sync_action = 'none' WHERE id = ?",
                  [entityId]
                );
              } else {
                await getDb().runAsync(
                  `UPDATE ${table} SET status = 'synced', sync_action = 'none', last_synced_at = ? WHERE id = ?`,
                  [now, entityId]
                );
              }
            }

          }

          // DELETE: mark the local tombstone as confirmed-synced
          if (action.method === "DELETE") {
            const deleteTable = entityTableForPath(action.path);
            // Extract the last path segment — with UUIDs this is the entity's UUID
            const lastSegment = action.path.split("/").filter(Boolean).pop();
            if (deleteTable && lastSegment) {
              await getDb().runAsync(
                `UPDATE ${deleteTable} SET sync_action = 'delete', status = 'synced' WHERE id = ?`,
                [lastSegment]
              );
            }
          }
        } catch (e) {
          console.error("Failed to apply local side effects after sync", e);
          await markSyncActionStatus(action.id, "failed", true, "Local side effects failed after server write");
          return;
        }

        await markSyncActionStatus(action.id, "completed");
      } else if (response.status === 409) {
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
      } else if (response.status >= 400 && response.status < 500) {
        const errBody = await response.json().catch(() => ({}));
        const errorMsg = `HTTP ${response.status}: ${errBody?.message ?? response.statusText ?? ""}`;
        await markSyncActionStatus(action.id, "dead", false, errorMsg);

        if (action.method === "POST" && (action.path === "/sales" || action.path === "/purchases")) {
          try {
            const reqPayload = JSON.parse(action.payload || "{}");
            if (reqPayload.items) {
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
            }
          } catch {}
        }
      } else {
        const errBody = await response.json().catch(() => ({}));
        await markSyncActionStatus(action.id, "failed", true, `HTTP ${response.status}: ${errBody?.message ?? response.statusText ?? ""}`);
      }
    } catch (err) {
      await markSyncActionStatus(action.id, "failed", true, String(err));
    }
  }

  /**
   * Run the outbox: probe server, claim pending actions, process in batches.
   */
  async triggerSync(authToken: string, callbacks?: OutboxCallbacks): Promise<void> {
    const BATCH_SIZE = 5;
    await getDb().runAsync(
      `UPDATE sync_queue
       SET status = 'pending', batch_id = NULL, retries = 0
       WHERE archived_at IS NULL
         AND status = 'dead'
         AND (last_error IS NULL OR last_error NOT LIKE 'HTTP 4%')
         AND retries < 10`
    );
    const pending = await claimPendingSyncActions(50);

    // Process actions sequentially to preserve FIFO ordering.
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      for (const action of batch) {
        const freshAction = await getDb().getFirstAsync<SyncAction>(
          "SELECT * FROM sync_queue WHERE id = ?",
          [action.id]
        );
        if (freshAction) {
          await this.processAction(freshAction, authToken);
        }
      }
    }

    callbacks?.onComplete?.();
  }

  /**
   * Count pending + dead actions.
   */
  async refreshCounts(): Promise<{
    pending: number;
    dead: number;
    failed: SyncAction[];
  }> {
    const [pending, dead, allFailed] = await Promise.all([
      getPendingSyncActionsCount(),
      getDeadSyncActionsCount(),
      getPendingSyncActions(),
    ]);
    return {
      pending,
      dead,
      failed: allFailed.filter((a) => a.status === "failed" || a.status === "dead"),
    };
  }
}
