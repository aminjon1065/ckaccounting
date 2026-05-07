// ─── Outbox processor ───────────────────────────────────────────────────────
//
// Orchestrates one or more passes over the sync_queue table:
//
//   1. Run the stuck-row sweeper (releaseStuckSyncActions) so a previously
//      crashed processor can't permanently strand its claimed rows.
//   2. Revive dead rows whose last error was NOT a 4xx (transient
//      infrastructure errors deserve another shot; 4xx validation errors
//      do not).
//   3. Claim a batch and dispatch each action to processAction.
//
// The HTTP/DB mechanics live in `./outbox/{buildRequest,handleSuccess,
// handleFailure}.ts` — this file just composes them.

import {
  claimPendingSyncActions,
  getDb,
  markSyncActionStatus,
  getPendingSyncActionsCount,
  getDeadSyncActionsCount,
  getPendingSyncActions,
  releaseStuckSyncActions,
  type SyncAction,
} from "../db";
import { buildOutboxRequest } from "./outbox/buildRequest";
import { handleOutboxSuccess } from "./outbox/handleSuccess";
import {
  handleOutboxClientError,
  handleOutboxConflict,
  handleOutboxServerError,
} from "./outbox/handleFailure";
import { reportMessage } from "@/lib/observability/reporter";

const STUCK_PROCESSING_THRESHOLD_MS = 90_000;

export interface OutboxCallbacks {
  onComplete?: () => void;
}

export class OutboxProcessor {
  /**
   * Process a single sync action: HTTP replay + DB updates + sale callbacks.
   * Catches everything — a single bad row must not abort the whole batch.
   */
  async processAction(action: SyncAction, authToken: string): Promise<void> {
    try {
      await markSyncActionStatus(action.id, "processing");

      const { url, options } = await buildOutboxRequest(action, authToken);
      const response = await fetch(url, options);

      if (response.ok) {
        await handleOutboxSuccess(action, response);
      } else if (response.status === 409) {
        await handleOutboxConflict(action, response);
      } else if (response.status >= 400 && response.status < 500) {
        await handleOutboxClientError(action, response);
      } else {
        await handleOutboxServerError(action, response);
      }
    } catch (err) {
      await markSyncActionStatus(action.id, "failed", true, String(err));
    }
  }

  /**
   * Run the outbox: sweep stuck rows, revive transient-dead rows, claim a
   * batch, process sequentially.
   */
  async triggerSync(authToken: string, callbacks?: OutboxCallbacks): Promise<void> {
    const BATCH_SIZE = 5;

    // Sweeper: rescue any rows a previous processor left stuck in
    // 'processing' (foreground crash, OS task killed mid-batch, etc.).
    // Runs every cycle so recovery is no longer gated on app launch.
    const swept = await releaseStuckSyncActions(STUCK_PROCESSING_THRESHOLD_MS);
    if (swept.released > 0 || swept.killed > 0) {
      reportMessage("Outbox sweeper recovered stuck rows", "info", {
        tag: "outbox-sweeper",
        released: swept.released,
        killed: swept.killed,
      });
    }

    // Revive dead rows whose last error is NOT a 4xx — those were transient
    // infrastructure errors and deserve another shot. 4xx (validation, auth,
    // missing FK) stay dead until a human resolves them via the dead-letter UI.
    await getDb().runAsync(
      `UPDATE sync_queue
       SET status = 'pending', batch_id = NULL, retries = 0
       WHERE archived_at IS NULL
         AND status = 'dead'
         AND (last_error IS NULL OR last_error NOT LIKE 'HTTP 4%')
         AND retries < 10`
    );
    const pending = await claimPendingSyncActions(50);

    // Sequential dispatch preserves FIFO ordering — important when later
    // actions depend on earlier ones (e.g. PATCH after POST for the same id).
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

  /** Count pending + dead actions; used by the sync status UI. */
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
