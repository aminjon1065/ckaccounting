import { API_URL } from "@/constants/config";
import {
  claimPendingSyncActions,
  getDb,
  markSyncActionStatus,
  onSaleSyncSuccess,
  cancelPendingStockDelta,
  queueSyncAction,
  getPendingSyncActionsCount,
  getDeadSyncActionsCount,
  getPendingSyncActions,
  type SyncAction,
} from "../db";
import { Conflict, detectConflict, queueExternalConflict } from "./ConflictContext";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Return quantity as a safe positive finite number, or null if invalid. */
function safeQty(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function entityTableForPath(path: string): string | null {
  // Check more-specific paths before general ones to avoid misrouting.
  // /debts/{id}/transactions must match before /debts/{id}.
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

      // Use idempotency key from dedicated column if available, otherwise fall back to header
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

      if (action.method === "POST" && /\/debts\/[^/]+\/transactions$/.test(action.path)) {
        try {
          const debtId = Number(action.path.match(/\/debts\/([^/]+)\/transactions$/)?.[1]);
          const debt = await getDb().getFirstAsync<{ direction: string | null; balance: number | null; balance_kopecks: number | null }>(
            "SELECT direction, balance, balance_kopecks FROM debts WHERE id = ?",
            [debtId]
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
          formData.append("photo", {
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
        await markSyncActionStatus(action.id, "completed");

        if (action.method === "POST" && action.path === "/sales") {
          try {
            const reqPayload = JSON.parse(action.payload || "{}");
            if (reqPayload.items) {
              for (const item of reqPayload.items) {
                const qty = safeQty(item.quantity);
                if (item.product_id != null && qty !== null) {
                  await onSaleSyncSuccess(item.product_id, qty);
                }
              }
            }
          } catch {}
        }

        try {
          const responseData = await response.json().catch(() => ({}));
          const realId = responseData?.data?.id ?? responseData?.id;
          const reqPayload = JSON.parse(action.payload || "{}");
          const localId = reqPayload._local_id ?? (
            reqPayload._temp_id != null ? String(reqPayload._temp_id) : undefined
          );
          const now = new Date().toISOString();

          if (realId && localId) {
            const table = entityTableForPath(action.path);
            if (table) {
              if (table === "debt_transactions") {
                // FIX (transaction duplication): Update the transaction's local tempId to the
                // real server id so subsequent remote pulls match by id and don't insert duplicates.
                await getDb().runAsync(
                  "UPDATE debt_transactions SET id = ?, sync_action = 'none' WHERE id = ? OR local_id = ?",
                  [realId, Number(localId), localId]
                );
              } else if (table === "debts") {
                await getDb().runAsync(
                  "UPDATE debts SET id = ?, sync_action = 'none', last_synced_at = ?, updated_at = ? WHERE local_id = ? OR id = ?",
                  [realId, now, now, localId, Number(localId)]
                );
                await getDb().runAsync(
                  "UPDATE debt_transactions SET debt_id = ? WHERE debt_id = ?",
                  [realId, Number(localId)]
                );
              } else {
                await getDb().runAsync(
                  `UPDATE ${table} SET id = ?, status = 'synced', sync_action = 'none', last_synced_at = ? WHERE local_id = ?`,
                  [realId, now, localId]
                );
              }
            }

            if (table === "products" && action.method === "POST") {
              try {
                const row = await getDb().getFirstAsync<{ photo_url: string | null }>(
                  "SELECT photo_url FROM products WHERE local_id = ?", [localId]
                );
                if (row?.photo_url?.startsWith("file://")) {
                  const formData = new FormData();
                  formData.append("photo", {
                    uri: row.photo_url,
                    type: "image/jpeg",
                    name: "photo.jpg",
                  } as any);
                  const photoResponse = await fetch(`${API_URL}/products/${realId}`, {
                    method: "PATCH",
                    headers: { "Authorization": `Bearer ${authToken}`, "Accept": "application/json" },
                    body: formData,
                  });
                  if (!photoResponse.ok) {
                    await queueSyncAction(
                      "PATCH", `/products/${realId}`,
                      { photo_uri: row.photo_url },
                      { "Content-Type": "multipart/form-data" }
                    );
                  }
                }
              } catch {}
            }

            if (action.path.startsWith("/debts")) {
              const tempId = localId;
              await getDb().runAsync(
                "UPDATE sync_queue SET path = REPLACE(path, ?, ?) WHERE path LIKE ?",
                [`/debts/${tempId}/`, `/debts/${realId}/`, `/debts/${tempId}/%`]
              );
              await getDb().runAsync(
                "UPDATE sync_queue SET path = REPLACE(path, ?, ?) WHERE path = ?",
                [`/debts/${tempId}`, `/debts/${realId}`, `/debts/${tempId}`]
              );
            }
          }
        } catch (e) {
          console.error("Failed to map real ID to local row", e);
        }
      } else if (response.status === 409) {
        // Conflict: server returned its version — detect per-field and escalate to UI
        try {
          const responseData = await response.json().catch(() => ({}));
          const serverData = responseData?.server_data ?? responseData?.data ?? {};
          const reqPayload = JSON.parse(action.payload || "{}");
          const localId = reqPayload._local_id ?? (
            reqPayload._temp_id != null ? String(reqPayload._temp_id) : undefined
          );
          if (serverData && Object.keys(serverData).length > 0) {
            const table = entityTableForPath(action.path);
            const entityType = table === "sales" ? "sale"
              : table === "expenses" ? "expense"
              : table === "purchases" ? "purchase"
              : table === "debts" ? "debt"
              : "product";
            const conflict = detectConflict(localId ?? String(serverData.id), entityType, reqPayload, serverData);
            if (conflict) {
              queueExternalConflict(conflict);
            }
          }
          await markSyncActionStatus(action.id, "failed", false, "Conflict detected");
        } catch {}
      } else if (response.status >= 400 && response.status < 500) {
        const errBody = await response.json().catch(() => ({}));
        const errorMsg = errBody?.message ?? `HTTP ${response.status}`;
        await markSyncActionStatus(action.id, "dead", false, errorMsg);

        if (action.method === "POST" && action.path === "/sales") {
          try {
            const reqPayload = JSON.parse(action.payload || "{}");
            if (reqPayload.items) {
              for (const item of reqPayload.items) {
                const qty = safeQty(item.quantity);
                if (item.product_id != null && qty !== null) {
                  await cancelPendingStockDelta(item.product_id, qty);
                }
              }
            }
          } catch {}
        }
      } else {
        const errBody = await response.json().catch(() => ({}));
        await markSyncActionStatus(action.id, "failed", true, errBody?.message ?? `HTTP ${response.status}`);
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
    // FIX (Bug 3): Only resurrect debt actions that died from transient errors (5xx/network).
    // Permanent 4xx failures (validation, auth) must NOT be retried — doing so creates an
    // infinite loop: dead → pending → 4xx → dead → pending → … every 60 seconds.
    // Also cap total resets so a stuck action can't run forever.
    await getDb().runAsync(
      `UPDATE sync_queue
       SET status = 'pending', batch_id = NULL
       WHERE archived_at IS NULL
         AND status = 'dead'
         AND (last_error IS NULL OR last_error NOT LIKE 'HTTP 4%')
         AND retries < 10`
    );
    const pending = await claimPendingSyncActions(50);

    // Process actions sequentially to preserve FIFO ordering. Actions within a batch
    // are claimed atomically by claimPendingSyncActions, but concurrent dispatch would
    // violate causal ordering (e.g. a product photo PATCH racing before the product
    // POST that assigns the real server ID). Serial processing ensures each action
    // completes and its ID-mapping side-effects are visible before the next starts.
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
