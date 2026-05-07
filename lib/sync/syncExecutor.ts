// ─── Sync executor ─────────────────────────────────────────────────────────────
//
// Bridge between SyncCoordinator (queue + coalescing) and SyncOrchestrator
// (the actual fetchers). Each call wraps the orchestrator call in
// `withSyncLock`, so cross-process callers (the OS background-fetch task)
// participate in the same advisory lock.

import { SyncOrchestrator } from "./SyncOrchestrator";
import { withSyncLock, SyncLockBusyError } from "./syncLock";
import type {
  SyncExecutor,
  SyncJob,
  PullOlderPayload,
  PullAllHistoryPayload,
} from "./SyncCoordinator";
import { reportError, reportMessage } from "@/lib/observability/reporter";

export interface ExecutorOptions {
  orchestrator: SyncOrchestrator;
  /** Identifier used in the cross-process lock and in diagnostics. */
  holder: string;
  /**
   * How long the foreground process is willing to wait if the OS
   * background-fetch task currently holds the lock. The OS task runs ≤ 30 s
   * by iOS budget, so 5 s strikes a good balance between user-perceived
   * responsiveness and not redundantly skipping work.
   */
  lockWaitMs?: number;
}

export function createSyncExecutor(opts: ExecutorOptions): SyncExecutor {
  const lockWaitMs = opts.lockWaitMs ?? 5_000;

  return async function execute(job: SyncJob): Promise<unknown> {
    try {
      return await withSyncLock(
        { holder: opts.holder, waitMs: lockWaitMs },
        () => dispatch(opts.orchestrator, job)
      );
    } catch (e) {
      if (e instanceof SyncLockBusyError) {
        // A peer (almost certainly the background fetch task) is mid-sync.
        // Surface the event so the caller — and the listener-driven UI —
        // can decide what to do. The coordinator will not auto-retry; the
        // next user action / AppState event re-enqueues.
        reportMessage("Sync job skipped: lock held by peer", "info", {
          tag: "sync-lock-busy",
          jobKind: job.kind,
          peerHolder: e.currentHolder ?? "unknown",
        });
      }
      throw e;
    }
  };
}

async function dispatch(
  o: SyncOrchestrator,
  job: SyncJob
): Promise<unknown> {
  switch (job.kind) {
    case "outbox":
      await o.syncOutbox();
      return;
    case "full":
      await o.syncAll(false);
      // After a successful pull, surface low-stock alerts. Failures here
      // are non-fatal — they don't roll back the sync.
      await o.checkLowStock().catch((e) => reportError(e, { tag: "sync-low-stock-check", op: "post-full-sync" }));
      return;
    case "pull:products":
      await o.refreshProducts(false);
      return;
    case "pull:debts":
      await o.refreshDebts(false);
      return;
    case "pull:shops":
      await o.refreshShops(false);
      return;
    case "pull:sales":
      await o.refreshSales(false);
      return;
    case "pull:expenses":
      await o.refreshExpenses(false);
      return;
    case "pull:purchases":
      await o.refreshPurchases(false);
      return;
    case "pullOlder:sales":
      return await o.fetchOlderSales((job.payload as PullOlderPayload | undefined)?.pages ?? 5);
    case "pullOlder:expenses":
      return await o.fetchOlderExpenses((job.payload as PullOlderPayload | undefined)?.pages ?? 5);
    case "pullOlder:purchases":
      return await o.fetchOlderPurchases((job.payload as PullOlderPayload | undefined)?.pages ?? 5);
    case "pullAllHistory":
      await o.fetchAllHistory((job.payload as PullAllHistoryPayload | undefined)?.onProgress);
      return;
  }
}
