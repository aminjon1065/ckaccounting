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

// ─── SyncOrchestrator ──────────────────────────────────────────────────────────
//
// Coordinates all sync fetchers + outbox. Does NOT import React.
// SyncContext uses this as a pure-logic delegate.

export interface SyncCounts {
  pending: number;
  dead: number;
  failed: SyncAction[];
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
        console.error(`Failed to fetch remote ${fetchTasks[i].name}:`, r.reason);
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
      console.warn("debtFetcher failed:", e);
    }
  }

  async refreshShops(forceFullSync = false): Promise<void> {
    try {
      await this.shopFetcher.fetch(forceFullSync);
    } catch (e) {
      console.warn("shopFetcher failed:", e);
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
   * Drain all remaining historical pages for sales / expenses / purchases.
   * Used by the "load full history" settings action so the user can have
   * the entire dataset locally without scrolling page-by-page.
   *
   * Calls onProgress({ entity, pagesPulled }) after every chunk so the UI
   * can render a live counter. Stops when each fetcher reports no more
   * data on the server.
   */
  async fetchAllHistory(onProgress?: (s: { entity: "sales" | "expenses" | "purchases"; pagesPulled: number }) => void): Promise<void> {
    const PAGE_CHUNK = 5;
    const MAX_CHUNKS = 200; // safety cap: 200 * 5 * 100 = 100k records per entity

    const drain = async (
      entity: "sales" | "expenses" | "purchases",
      fn: (pages: number) => Promise<boolean>,
    ) => {
      let pagesPulled = 0;
      for (let i = 0; i < MAX_CHUNKS; i++) {
        const more = await fn(PAGE_CHUNK);
        pagesPulled += PAGE_CHUNK;
        onProgress?.({ entity, pagesPulled });
        if (!more) break;
      }
    };

    await drain("sales", (p) => this.saleFetcher.fetchOlder(p));
    await drain("expenses", (p) => this.expenseFetcher.fetchOlder(p));
    await drain("purchases", (p) => this.purchaseFetcher.fetchOlder(p));
  }
}
