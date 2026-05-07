// ─── SyncCoordinator ───────────────────────────────────────────────────────────
//
// Single in-flight slot + priority queue for every sync operation in the app.
// Replaces the scattered `syncLock` / `pendingReconnectSync` / `inFlightSyncRef`
// state machine in SyncContext.
//
// Guarantees:
//   * At most ONE job runs at a time (foreground process).
//   * Identical jobs are coalesced — a second `outbox` request that arrives
//     while the first is running attaches to a single pending re-run instead
//     of stacking N copies.
//   * Priority: `high` (manual user trigger) > `normal` (full sync) > `low`
//     (history backfill). Within a priority, FIFO.
//   * Pure logic — no React, no SQLite, no orchestrator import. The executor
//     callback is injected; the coordinator only sequences calls to it.
//
// Cross-process coordination with the OS background-fetch task is layered on
// top by the executor (which wraps each job in `withSyncLock`).

import { reportError } from "@/lib/observability/reporter";
import type { HistoryProgress } from "./SyncOrchestrator";

export type SyncJobKind =
  | "outbox"
  | "full"
  | "pull:products"
  | "pull:debts"
  | "pull:shops"
  | "pull:sales"
  | "pull:expenses"
  | "pull:purchases"
  | "pullOlder:sales"
  | "pullOlder:expenses"
  | "pullOlder:purchases"
  | "pullAllHistory";

export type SyncPriority = "high" | "normal" | "low";

export interface PullOlderPayload {
  pages: number;
}

export interface PullAllHistoryPayload {
  onProgress?: (s: HistoryProgress) => void;
}

export type SyncJobPayload =
  | undefined
  | PullOlderPayload
  | PullAllHistoryPayload;

export interface SyncJob {
  kind: SyncJobKind;
  priority: SyncPriority;
  payload: SyncJobPayload;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
}

export type SyncExecutor = (job: SyncJob) => Promise<unknown>;

export interface CoordinatorState {
  busy: boolean;
  current: SyncJobKind | null;
  queueDepth: number;
  queueKinds: SyncJobKind[];
}

export type CoordinatorListener = (state: CoordinatorState) => void;

// Coalescing: identical `kind` jobs without per-call payload share one promise.
// `pullOlder:*` and `pullAllHistory` carry payload (pages, onProgress) and are
// not coalesced — each call gets its own job.
function isCoalescable(kind: SyncJobKind): boolean {
  return (
    kind === "outbox" ||
    kind === "full" ||
    kind === "pull:products" ||
    kind === "pull:debts" ||
    kind === "pull:shops" ||
    kind === "pull:sales" ||
    kind === "pull:expenses" ||
    kind === "pull:purchases"
  );
}

const PRIORITY_ORDER: SyncPriority[] = ["high", "normal", "low"];

export class SyncCoordinator {
  private executor: SyncExecutor;
  private queue: SyncJob[] = [];
  private inflight: SyncJob | null = null;
  private listeners = new Set<CoordinatorListener>();
  private cancelled = false;

  constructor(executor: SyncExecutor) {
    this.executor = executor;
  }

  enqueue<R = unknown>(
    kind: SyncJobKind,
    opts: { priority?: SyncPriority; payload?: SyncJobPayload } = {}
  ): Promise<R> {
    if (this.cancelled) {
      return Promise.reject(new Error("SyncCoordinator is cancelled"));
    }

    const priority = opts.priority ?? defaultPriority(kind);

    const existing = this.findCoalesceTarget(kind);
    if (existing) {
      return existing.promise as Promise<R>;
    }

    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const job: SyncJob = {
      kind,
      priority,
      payload: opts.payload,
      promise,
      resolve,
      reject,
      enqueuedAt: Date.now(),
    };

    insertByPriority(this.queue, job);
    this.notify();
    void this.kick();

    return promise as Promise<R>;
  }

  private findCoalesceTarget(kind: SyncJobKind): SyncJob | null {
    if (!isCoalescable(kind)) return null;
    if (this.inflight && this.inflight.kind === kind) {
      // A job of this kind is currently running. Coalesce against the
      // *pending re-run* of the same kind (creating one if none exists),
      // NOT against the in-flight job itself — the caller wants to ensure
      // their newly-enqueued work is captured AFTER the current one finishes.
      const queued = this.queue.find((j) => j.kind === kind);
      return queued ?? null;
    }
    const queued = this.queue.find((j) => j.kind === kind);
    return queued ?? null;
  }

  private async kick(): Promise<void> {
    if (this.inflight || this.cancelled) return;
    const job = this.queue.shift();
    if (!job) return;

    this.inflight = job;
    this.notify();

    try {
      const result = await this.executor(job);
      job.resolve(result);
    } catch (e) {
      job.reject(e);
    } finally {
      this.inflight = null;
      this.notify();
      // Tail-call next job; setTimeout(0) keeps the stack flat and lets any
      // microtasks queued by `resolve()` (e.g., React state updates) run first.
      if (this.queue.length > 0 && !this.cancelled) {
        setTimeout(() => void this.kick(), 0);
      }
    }
  }

  cancelAll(reason: string): void {
    this.cancelled = true;
    const drained = this.queue.splice(0);
    for (const job of drained) {
      job.reject(new Error(reason));
    }
    // The in-flight job is allowed to finish; the executor cannot be safely
    // interrupted mid-HTTP without leaving the outbox in `processing`.
    this.notify();
  }

  /** Re-enable the coordinator after a previous `cancelAll`. Used on re-login. */
  reset(): void {
    this.cancelled = false;
  }

  subscribe(listener: CoordinatorListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): CoordinatorState {
    return this.snapshot();
  }

  private snapshot(): CoordinatorState {
    return {
      busy: this.inflight !== null,
      current: this.inflight?.kind ?? null,
      queueDepth: this.queue.length,
      queueKinds: this.queue.map((j) => j.kind),
    };
  }

  private notify(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (e) {
        reportError(e, { tag: "sync-coordinator-listener" });
      }
    }
  }
}

function defaultPriority(kind: SyncJobKind): SyncPriority {
  switch (kind) {
    case "outbox":
      return "high";
    case "full":
    case "pull:products":
    case "pull:debts":
    case "pull:shops":
    case "pull:sales":
    case "pull:expenses":
    case "pull:purchases":
      return "normal";
    case "pullOlder:sales":
    case "pullOlder:expenses":
    case "pullOlder:purchases":
    case "pullAllHistory":
      return "low";
  }
}

function insertByPriority(queue: SyncJob[], job: SyncJob): void {
  const targetRank = PRIORITY_ORDER.indexOf(job.priority);
  // Insert before the first job with strictly lower priority (higher rank
  // index). Within the same priority, append (FIFO).
  for (let i = 0; i < queue.length; i++) {
    const rank = PRIORITY_ORDER.indexOf(queue[i].priority);
    if (rank > targetRank) {
      queue.splice(i, 0, job);
      return;
    }
  }
  queue.push(job);
}
