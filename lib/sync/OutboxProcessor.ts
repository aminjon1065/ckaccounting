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
  if (path.includes("/sales")) return "sales";
  if (path.includes("/products")) return "products";
  if (path.includes("/expenses")) return "expenses";
  if (path.includes("/purchases")) return "purchases";
  if (path.includes("/shops")) return "shops";
  return null;
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

      const requestUrl = action.path.startsWith("http")
        ? action.path
        : `${API_URL}${action.path.startsWith("/") ? action.path : `/${action.path}`}`;

      let fetchOptions: RequestInit = {
        method: action.method,
        headers: { ...baseHeaders, ...customHeaders },
      };

      try {
        const reqPayload = action.payload ? JSON.parse(action.payload) : {};
        if (reqPayload.photo_uri) {
          const formData = new FormData();
          formData.append("photo", {
            uri: reqPayload.photo_uri,
            type: "image/jpeg",
            name: "photo.jpg",
          } as any);
          fetchOptions.body = formData as any;
          delete (fetchOptions.headers as Record<string, string>)["Content-Type"];
        } else {
          fetchOptions.body = action.payload;
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
          const localId = reqPayload._local_id;
          const now = new Date().toISOString();

          if (realId && localId) {
            const table = entityTableForPath(action.path);
            if (table) {
              await getDb().runAsync(
                `UPDATE ${table} SET id = ?, status = 'synced', sync_action = 'none', last_synced_at = ? WHERE local_id = ?`,
                [realId, now, localId]
              );
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
          const localId = reqPayload._local_id;
          if (serverData && Object.keys(serverData).length > 0) {
            const conflict = detectConflict(localId ?? String(serverData.id), "product", reqPayload, serverData);
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
    // Reachability check
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const probeRes = await fetch(`${API_URL}/health`, {
        method: "HEAD",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // Block on 3xx redirects (captive portal) or 5xx (server error); allow 2xx + 404
      if (probeRes.status >= 300 && probeRes.status < 500 && probeRes.status !== 404) {
        console.warn(`Server probe returned ${probeRes.status}, skipping sync`);
        return;
      }
    } catch {
      console.warn("Server unreachable, skipping sync");
      return;
    }

    const BATCH_SIZE = 5;
    const pending = await claimPendingSyncActions(50);

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((action) => this.processAction(action, authToken))
      );
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
