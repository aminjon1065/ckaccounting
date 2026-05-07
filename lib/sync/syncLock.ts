// ─── Cross-process sync lock ───────────────────────────────────────────────────
//
// SQLite-backed advisory lock shared between the foreground React app and the
// OS background-fetch task (which runs in a separate JS context with its own
// in-memory state). Both contexts call `withSyncLock()` before performing any
// outbox/replication work; only one holder can run at a time.
//
// The lock is just a single row in `sync_lock` (created by migration v27)
// with TTL semantics — a crashed holder cannot deadlock peers because the
// `expires_at` timestamp lets others reclaim the slot.
//
// This is *advisory*: it only protects callers that participate. Direct
// SQLite writes outside the sync layer aren't gated by it.

import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/reporter";

const DEFAULT_TTL_MS = 120_000; // 2 minutes — generous, full sync ≪ this
const ACQUIRE_RETRY_DELAY_MS = 250;

export interface AcquireOptions {
  /** Identifier for diagnostics: e.g. "foreground:full" or "bg-task". */
  holder: string;
  /** How long the lock is held before peers can reclaim it. */
  ttlMs?: number;
  /**
   * How long the caller is willing to wait for a peer to release the lock.
   * Defaults to 0 — fail fast. The foreground coordinator wants to give up
   * quickly and reschedule; the OS task uses 0 to skip when foreground holds
   * the lock.
   */
  waitMs?: number;
}

export class SyncLockBusyError extends Error {
  constructor(public readonly currentHolder: string | null) {
    super(`Sync lock is held by ${currentHolder ?? "unknown"}`);
    this.name = "SyncLockBusyError";
  }
}

interface LockRow {
  holder: string | null;
  expires_at: string | null;
}

/**
 * Try to acquire the sync lock. Resolves with `true` on success, throws
 * `SyncLockBusyError` if another holder is active and the wait budget runs
 * out. Re-entrant on the same process: if the current holder is `holder`
 * and not yet expired, we extend the TTL and return success — this lets
 * nested calls (e.g., conflict-resolution recursing into outbox replay)
 * reuse the slot without deadlock.
 */
export async function acquireSyncLock(opts: AcquireOptions): Promise<void> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const waitMs = opts.waitMs ?? 0;
  const giveUpAt = Date.now() + waitMs;

  for (;;) {
    const acquired = await tryAcquireOnce(opts.holder, ttlMs);
    if (acquired) return;

    if (Date.now() >= giveUpAt) {
      const current = await readCurrentHolder();
      throw new SyncLockBusyError(current);
    }
    await sleep(ACQUIRE_RETRY_DELAY_MS);
  }
}

async function tryAcquireOnce(holder: string, ttlMs: number): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);

  // Atomic claim: the WHERE clause covers three valid cases —
  //   (1) the slot is free (holder IS NULL),
  //   (2) the previous holder's TTL has lapsed (we're reclaiming a stale
  //       lock from a crashed peer), or
  //   (3) we are the current holder ourselves (re-entrant TTL refresh).
  const result = await db.runAsync(
    `UPDATE sync_lock
     SET holder = ?, acquired_at = ?, expires_at = ?
     WHERE id = 1
       AND (
         holder IS NULL
         OR datetime(expires_at) < datetime(?)
         OR holder = ?
       )`,
    [holder, now.toISOString(), expires.toISOString(), now.toISOString(), holder]
  );

  return (result.changes ?? 0) > 0;
}

async function readCurrentHolder(): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<LockRow>(
    "SELECT holder, expires_at FROM sync_lock WHERE id = 1"
  );
  return row?.holder ?? null;
}

/**
 * Release the lock IF we still hold it. Idempotent and safe to call from
 * `finally` blocks. We check holder identity to avoid clobbering a peer
 * that may have legitimately reclaimed an expired lock between our
 * acquisition and release.
 */
export async function releaseSyncLock(holder: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE sync_lock
     SET holder = NULL, acquired_at = NULL, expires_at = NULL
     WHERE id = 1 AND holder = ?`,
    [holder]
  );
}

/**
 * Run `fn` while holding the lock. Releases on exit, including on throw.
 * Re-throws `SyncLockBusyError` if the lock could not be acquired within
 * `waitMs`; the caller decides whether to skip, retry, or surface the
 * error.
 */
export async function withSyncLock<T>(
  opts: AcquireOptions,
  fn: () => Promise<T>
): Promise<T> {
  await acquireSyncLock(opts);
  try {
    return await fn();
  } finally {
    await releaseSyncLock(opts.holder).catch((e) => {
      reportError(e, { tag: "sync-lock-release" });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
