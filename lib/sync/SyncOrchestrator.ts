import {
  getPendingSyncActionsCount,
  getDeadSyncActionsCount,
  getPendingSyncActions,
  checkAndNotifyLowStock,
  type SyncAction,
} from "../db";
import { OutboxProcessor } from "./OutboxProcessor";
import { RemoteProductFetcher } from "./RemoteProductFetcher";
import { RemoteDebtFetcher } from "./RemoteDebtFetcher";
import { RemoteShopFetcher } from "./RemoteShopFetcher";
import { RemoteSaleFetcher } from "./RemoteSaleFetcher";
import { RemoteExpenseFetcher } from "./RemoteExpenseFetcher";
import { RemotePurchaseFetcher } from "./RemotePurchaseFetcher";
import { reportError } from "@/lib/observability/reporter";

// ─── SyncOrchestrator ──────────────────────────────────────────────────────────
//
// Coordinates all sync fetchers + outbox. Does NOT import React.
// SyncContext uses this as a pure-logic delegate.

export interface SyncCounts {
  pending: number;
  dead: number;
  failed: SyncAction[];
}

/**
 * Entities that report progress to the "Load all history" UI. Must include
 * every fetcher fetchAllHistory touches so the user sees per-entity ticks
 * and the progress UI doesn't silently hide one (the way it hid debts
 * before this set was made explicit).
 */
export type HistoryEntity =
  | "products"
  | "shops"
  | "debts"
  | "sales"
  | "expenses"
  | "purchases";

export interface HistoryProgress {
  entity: HistoryEntity;
  pagesPulled: number;
}

export class SyncOrchestrator {
  private outbox: OutboxProcessor;
  private productFetcher: RemoteProductFetcher;
  private debtFetcher: RemoteDebtFetcher;
  private shopFetcher: RemoteShopFetcher;
  private saleFetcher: RemoteSaleFetcher;
  private expenseFetcher: RemoteExpenseFetcher;
  private purchaseFetcher: RemotePurchaseFetcher;

  constructor(
    private getDeps: () => { token: string; shopId: number | undefined; role?: string; userId?: number }
  ) {
    this.outbox = new OutboxProcessor();
    this.productFetcher = new RemoteProductFetcher(getDeps);
    this.debtFetcher = new RemoteDebtFetcher(() => ({ token: getDeps().token }));
    this.shopFetcher = new RemoteShopFetcher(() => ({ token: getDeps().token }));
    this.saleFetcher = new RemoteSaleFetcher(() => ({
      token: getDeps().token,
      shopId: getDeps().shopId,
      role: getDeps().role,
      userId: getDeps().userId,
    }));
    this.expenseFetcher = new RemoteExpenseFetcher(() => ({ token: getDeps().token }));
    this.purchaseFetcher = new RemotePurchaseFetcher(() => ({ token: getDeps().token }));
  }

  /**
   * Process the outbox queue: probe server, claim & replay pending actions.
   */
  async syncOutbox(onComplete?: () => void): Promise<void> {
    const { token } = this.getDeps();
    if (!token) return;
    await this.outbox.triggerSync(token, { onComplete });
  }

  /**
   * Pull all remote entities. Network requests run in parallel — each fetcher
   * already wraps its DB writes in withTransactionAsync, which expo-sqlite
   * serializes internally, so parallel fetches are safe and dramatically
   * faster on cold start (1 round-trip instead of 6 sequential).
   */
  async refreshAll(forceFullSync = false): Promise<void> {
    const isSeller = this.getDeps().role === "seller";
    const fetchTasks: Array<{ name: string; task: () => Promise<unknown> }> = [
      { name: "products", task: () => this.productFetcher.fetch(forceFullSync) },
      { name: "debts", task: () => this.debtFetcher.fetch(forceFullSync) },
      { name: "shops", task: () => this.shopFetcher.fetch(forceFullSync) },
      { name: "sales", task: () => this.saleFetcher.fetch(forceFullSync) },
    ];
    if (!isSeller) {
      fetchTasks.push(
        { name: "expenses", task: () => this.expenseFetcher.fetch(forceFullSync) },
        { name: "purchases", task: () => this.purchaseFetcher.fetch(forceFullSync) }
      );
    }

    const results = await Promise.allSettled(fetchTasks.map(({ task }) => task()));
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        reportError(r.reason, { tag: "sync-orchestrator", op: "refreshAll", entity: fetchTasks[i].name });
      }
    });
  }

  /**
   * Full sync cycle: outbox → all remote fetches.
   */
  async syncAll(forceFullSync = false): Promise<void> {
    await this.syncOutbox();
    await this.refreshAll(forceFullSync);
  }

  /**
   * Check and notify low stock after products are fetched.
   */
  async checkLowStock(): Promise<void> {
    const { shopId } = this.getDeps();
    if (!shopId) return;
    await checkAndNotifyLowStock(shopId);
  }

  /**
   * Refresh pending / dead / failed action counts for UI display.
   */
  async refreshCounts(): Promise<SyncCounts> {
    return this.outbox.refreshCounts();
  }

  async refreshDebts(forceFullSync = false): Promise<void> {
    try {
      await this.debtFetcher.fetch(forceFullSync);
    } catch (e) {
      reportError(e, { tag: "sync-orchestrator", op: "refreshDebts" });
    }
  }

  async refreshShops(forceFullSync = false): Promise<void> {
    try {
      await this.shopFetcher.fetch(forceFullSync);
    } catch (e) {
      reportError(e, { tag: "sync-orchestrator", op: "refreshShops" });
    }
  }

  async refreshProducts(forceFullSync = false): Promise<void> {
    try {
      await this.productFetcher.fetch(forceFullSync);
    } catch (e) {
      reportError(e, { tag: "sync-orchestrator", op: "refreshProducts" });
    }
  }

  async refreshSales(forceFullSync = false): Promise<void> {
    try {
      await this.saleFetcher.fetch(forceFullSync);
    } catch (e) {
      reportError(e, { tag: "sync-orchestrator", op: "refreshSales" });
    }
  }

  async refreshExpenses(forceFullSync = false): Promise<void> {
    if (this.getDeps().role === "seller") return;
    try {
      await this.expenseFetcher.fetch(forceFullSync);
    } catch (e) {
      reportError(e, { tag: "sync-orchestrator", op: "refreshExpenses" });
    }
  }

  async refreshPurchases(forceFullSync = false): Promise<void> {
    if (this.getDeps().role === "seller") return;
    try {
      await this.purchaseFetcher.fetch(forceFullSync);
    } catch (e) {
      reportError(e, { tag: "sync-orchestrator", op: "refreshPurchases" });
    }
  }

  /**
   * Pull historical pages below the current local window. Used by lists
   * that hit the bottom of locally-synced data — extends the window
   * without re-running the full sync cycle.
   */
  async fetchOlderSales(pages = 5): Promise<boolean> {
    return this.saleFetcher.fetchOlder(pages);
  }

  async fetchOlderExpenses(pages = 5): Promise<boolean> {
    return this.expenseFetcher.fetchOlder(pages);
  }

  async fetchOlderPurchases(pages = 5): Promise<boolean> {
    return this.purchaseFetcher.fetchOlder(pages);
  }

  /**
   * Drain all remaining historical pages for every offline-relevant entity.
   * Used by the "Load all history" settings action so the user can have
   * the entire dataset locally without scrolling page-by-page.
   *
   * Implementation must be self-sufficient — it can't assume the regular
   * sync has run, because the user may hit this button immediately after
   * sign-in or after wiping local data. Two-stage flow per entity:
   *
   *   stage 1: `fetch(forceFullSync=true)` — pulls the current window AND
   *            (for cursor-paginated entities) seeds `*_oldest_synced_at`
   *            so stage 2 has a starting boundary. Skipping stage 1 was
   *            the bug pre-fix: `fetchOlder()` returns false immediately
   *            when OLDEST_KEY is null, so the drain pulled zero records
   *            on a freshly-installed device.
   *
   *   stage 2: drain `fetchOlder()` until the server has nothing earlier.
   *            Only sales / expenses / purchases support fetchOlder; for
   *            catalog entities (products, shops, debts) stage 1 already
   *            pulled everything via the regular cursor.
   *
   * Calls onProgress after every chunk so the UI renders a live counter.
   */
  async fetchAllHistory(
    onProgress?: (s: HistoryProgress) => void,
  ): Promise<void> {
    const PAGE_CHUNK = 5;
    const MAX_CHUNKS = 200; // safety cap: 200 * 5 * 100 = 100k records per entity
    const isSeller = this.getDeps().role === "seller";

    // ── Stage 1: seed local data + OLDEST_KEY for every entity ────────────
    // Catalog-shaped fetchers (products / shops / debts) finish here — their
    // fetch(true) drains the entire dataset internally via cursor.
    //
    // For the cursor-paginated transactional entities (sales / expenses /
    // purchases) this populates the most-recent slice and stamps
    // `*_oldest_synced_at`, which stage 2 then walks backwards from.
    await this.productFetcher.fetch(true);
    onProgress?.({ entity: "products", pagesPulled: 1 });

    await this.shopFetcher.fetch(true);
    onProgress?.({ entity: "shops", pagesPulled: 1 });

    await this.debtFetcher.fetch(true);
    onProgress?.({ entity: "debts", pagesPulled: 1 });

    await this.saleFetcher.fetch(true);
    onProgress?.({ entity: "sales", pagesPulled: PAGE_CHUNK });

    if (!isSeller) {
      await this.expenseFetcher.fetch(true);
      onProgress?.({ entity: "expenses", pagesPulled: PAGE_CHUNK });

      await this.purchaseFetcher.fetch(true);
      onProgress?.({ entity: "purchases", pagesPulled: PAGE_CHUNK });
    }

    // ── Stage 2: drain older history for cursor-paginated entities ────────
    const drain = async (
      entity: HistoryEntity,
      fn: (pages: number) => Promise<boolean>,
      seed: number,
    ) => {
      let pagesPulled = seed;
      for (let i = 0; i < MAX_CHUNKS; i++) {
        const more = await fn(PAGE_CHUNK);
        pagesPulled += PAGE_CHUNK;
        onProgress?.({ entity, pagesPulled });
        if (!more) break;
      }
    };

    await drain("sales", (p) => this.saleFetcher.fetchOlder(p), PAGE_CHUNK);
    if (!isSeller) {
      await drain("expenses", (p) => this.expenseFetcher.fetchOlder(p), PAGE_CHUNK);
      await drain("purchases", (p) => this.purchaseFetcher.fetchOlder(p), PAGE_CHUNK);
    }
  }
}
