// ─── Sync queue helpers ───────────────────────────────────────────────────────
//
// CRUD over the `sync_queue` table: enqueue, claim, status updates,
// archival, pruning. The outbox processor (lib/sync/OutboxProcessor.ts)
// is the primary consumer; the SyncContext also queries counts for UI
// badges.
//
// `releaseStuckSyncActions` is the in-process sweeper that recovers rows
// stranded as 'processing' by a crashed processor. It also unwinds any
// `pending_stock_delta` left on products for sale/purchase rows it kills,
// so the UI's offline-stock view doesn't drift after a sweep.

import { getDb } from "./schema";
import { cancelPendingPurchaseStockDelta, cancelPendingStockDelta } from "./products";

export interface SyncAction {
  id: number;
  method: string;
  path: string;
  payload: string;
  headers: string | null;
  status: "pending" | "processing" | "failed" | "completed" | "dead";
  retries: number;
  created_at: string;
  last_error?: string | null;
  batch_id?: string | null;
  idempotency_key?: string | null;
  claimed_at?: string | null;
  archived_at?: string | null;
}

export async function queueSyncAction(
  method: string,
  path: string,
  payload: unknown,
  headers?: Record<string, string>,
  idempotencyKey?: string
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT INTO sync_queue (method, path, payload, headers, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      method,
      path,
      typeof payload === "string" ? payload : JSON.stringify(payload),
      headers ? JSON.stringify(headers) : null,
      idempotencyKey ?? null,
      new Date().toISOString(),
    ]
  );
}

/**
 * Atomically claim up to `batchSize` pending actions. Each row gets a
 * shared `batch_id` and a `claimed_at` timestamp so the sweeper can
 * detect crashed claims later. Rows already past the retry cap (>= 5)
 * are skipped — they need to be promoted to `dead` first by the sweeper.
 */
export async function claimPendingSyncActions(batchSize = 10): Promise<SyncAction[]> {
  const db = getDb();
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const claimedAt = new Date().toISOString();

  await db.runAsync(
    `UPDATE sync_queue
     SET status = 'processing', batch_id = ?, claimed_at = ?
     WHERE id IN (
       SELECT id FROM sync_queue
       WHERE archived_at IS NULL
         AND status IN ('pending', 'failed')
         AND retries < 5
       ORDER BY id ASC
       LIMIT ?
     )`,
    [batchId, claimedAt, batchSize]
  );

  return db.getAllAsync<SyncAction>(
    "SELECT * FROM sync_queue WHERE batch_id = ? ORDER BY id ASC",
    [batchId]
  );
}

export async function getPendingSyncActions(): Promise<SyncAction[]> {
  const db = getDb();
  return db.getAllAsync<SyncAction>(
    "SELECT * FROM sync_queue WHERE archived_at IS NULL AND status IN ('pending', 'failed', 'dead') ORDER BY id ASC LIMIT 50"
  );
}

export async function getPendingSyncActionsCount(): Promise<number> {
  const db = getDb();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE archived_at IS NULL AND status IN ('pending', 'failed')"
  );
  return Number(result?.count ?? 0);
}

export async function getDeadSyncActionsCount(): Promise<number> {
  const db = getDb();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE archived_at IS NULL AND status = 'dead'"
  );
  return Number(result?.count ?? 0);
}

/**
 * Update status of a queued action. Whenever the row leaves `processing`,
 * `claimed_at` is cleared so the sweeper doesn't mistake a finished/
 * failed row for a stuck one. Entering `processing` is owned by
 * `claimPendingSyncActions` — never set status='processing' here.
 */
export async function markSyncActionStatus(
  id: number,
  status: "pending" | "processing" | "failed" | "completed" | "dead",
  incrementRetry = false,
  lastError?: string
): Promise<void> {
  const db = getDb();
  if (status === "completed") {
    await db.runAsync(
      "UPDATE sync_queue SET status = 'completed', claimed_at = NULL, archived_at = ? WHERE id = ?",
      [new Date().toISOString(), id]
    );
    return;
  }
  if (status === "dead") {
    await db.runAsync(
      "UPDATE sync_queue SET status = 'dead', claimed_at = NULL, last_error = ? WHERE id = ?",
      [lastError ?? null, id]
    );
    return;
  }

  // status is 'pending' or 'failed' or 'processing'.
  const setClaimed = status === "processing" ? "" : ", claimed_at = NULL";
  if (incrementRetry) {
    const args: (string | number)[] = lastError !== undefined ? [status, lastError, id] : [status, id];
    await db.runAsync(
      `UPDATE sync_queue SET status = CASE WHEN retries >= 4 THEN 'dead' ELSE ? END, retries = retries + 1${
        lastError !== undefined ? ", last_error = ?" : ""
      }${setClaimed} WHERE id = ?`,
      args
    );
  } else {
    const args: (string | number)[] = lastError !== undefined ? [status, lastError, id] : [status, id];
    await db.runAsync(
      `UPDATE sync_queue SET status = ?${
        lastError !== undefined ? ", last_error = ?" : ""
      }${setClaimed} WHERE id = ?`,
      args
    );
  }
}

/** Archive a single sync_queue row (soft-delete instead of physical DELETE for audit). */
export async function archiveSyncAction(id: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE sync_queue SET archived_at = ? WHERE id = ?",
    [new Date().toISOString(), id]
  );
}

/**
 * Prune archived `completed` rows older than the cutoff. Keeps the audit
 * trail bounded while preserving recent rows for crash-recovery
 * idempotency reasoning. Dead / failed rows are never pruned.
 */
export async function pruneArchivedSyncActions(olderThanDays = 30): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  await db.runAsync(
    "DELETE FROM sync_queue WHERE archived_at IS NOT NULL AND archived_at < ? AND status = 'completed'",
    [cutoff]
  );
}

/** Archive every sync_queue row matching the given status filter. */
export async function archiveSyncActions(
  statuses: Array<"pending" | "failed" | "dead" | "completed">
): Promise<void> {
  const db = getDb();
  const placeholders = statuses.map(() => "?").join(", ");
  await db.runAsync(
    `UPDATE sync_queue SET archived_at = ? WHERE status IN (${placeholders}) AND archived_at IS NULL`,
    [new Date().toISOString(), ...statuses]
  );
}

// ─── Sweeper ────────────────────────────────────────────────────────────────

/**
 * For sale/purchase POST rows that the sweeper is about to kill, undo the
 * `pending_stock_delta` recorded when they were optimistically applied
 * locally. The 4xx path inside `OutboxProcessor.processAction` already
 * does this for server-rejected actions; this is the parallel path for
 * actions that died due to repeated stuck-in-processing.
 *
 * Silent on parse failures — a malformed payload shouldn't block the sweeper.
 */
async function unwindStockDeltaForOutboxRow(
  path: string,
  payload: string | null
): Promise<void> {
  if (path !== "/sales" && path !== "/purchases") return;
  if (!payload) return;
  let parsed: { items?: Array<{ product_id?: string; quantity?: number }> };
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (!parsed.items || !Array.isArray(parsed.items)) return;

  for (const item of parsed.items) {
    if (item.product_id == null) continue;
    const q = Number(item.quantity);
    if (!Number.isFinite(q) || q <= 0) continue;
    if (path === "/purchases") {
      await cancelPendingPurchaseStockDelta(String(item.product_id), q);
    } else {
      await cancelPendingStockDelta(String(item.product_id), q);
    }
  }
}

/**
 * Sweep rows that have been stuck in `processing` longer than `staleAfterMs`.
 * Called at the start of every outbox cycle so a single crashed processor
 * (foreground or background OS task) doesn't permanently strand its claimed
 * rows. Each unstuck row also burns a retry — repeated sweeping eventually
 * promotes a chronically-stuck row to `dead` (matching the retries < 5
 * cap used by `claimPendingSyncActions`), so a row truly broken at the
 * processing layer can't loop forever.
 *
 * Returns counts for telemetry; callers may surface them in dev builds.
 */
export async function releaseStuckSyncActions(
  staleAfterMs = 90_000
): Promise<{ released: number; killed: number }> {
  const db = getDb();
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString();

  // Before promoting stuck rows to `dead`, unwind any pending_stock_delta
  // they would otherwise leak. Without this, a sale POST killed by the
  // retry cap leaves a phantom decrement on `products.pending_stock_delta`
  // that the UI surfaces as wrong on-hand stock until the next full sync.
  const aboutToDie = await db.getAllAsync<{ path: string; payload: string | null }>(
    `SELECT path, payload FROM sync_queue
     WHERE status = 'processing'
       AND archived_at IS NULL
       AND claimed_at IS NOT NULL
       AND datetime(claimed_at) < datetime(?)
       AND retries >= 4`,
    [cutoff]
  );
  for (const row of aboutToDie) {
    await unwindStockDeltaForOutboxRow(row.path, row.payload);
  }

  // First, promote rows that would exceed the retry cap on the next claim
  // to `dead` so they don't keep getting swept indefinitely. Mirrors the
  // inline `WHEN retries >= 4` rule in markSyncActionStatus().
  const killed = await db.runAsync(
    `UPDATE sync_queue
     SET status = 'dead',
         batch_id = NULL,
         claimed_at = NULL,
         last_error = COALESCE(last_error, '') || ' | sweeper: max retries exceeded after stuck-in-processing'
     WHERE status = 'processing'
       AND archived_at IS NULL
       AND claimed_at IS NOT NULL
       AND datetime(claimed_at) < datetime(?)
       AND retries >= 4`,
    [cutoff]
  );

  // Remaining stuck rows go back to `pending` with retries++ so the next
  // outbox cycle picks them up again.
  const released = await db.runAsync(
    `UPDATE sync_queue
     SET status = 'pending',
         batch_id = NULL,
         claimed_at = NULL,
         retries = retries + 1,
         last_error = COALESCE(last_error, '') || ' | sweeper: stuck in processing'
     WHERE status = 'processing'
       AND archived_at IS NULL
       AND claimed_at IS NOT NULL
       AND datetime(claimed_at) < datetime(?)`,
    [cutoff]
  );

  return {
    released: released.changes ?? 0,
    killed: killed.changes ?? 0,
  };
}
