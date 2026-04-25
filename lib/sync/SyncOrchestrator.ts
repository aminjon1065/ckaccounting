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
    private getDeps: () => { token: string; shopId: number | undefined }
  ) {
    this.outbox = new OutboxProcessor();
    this.productFetcher = new RemoteProductFetcher(getDeps);
    this.debtFetcher = new RemoteDebtFetcher(() => ({ token: getDeps().token }));
    this.shopFetcher = new RemoteShopFetcher(() => ({ token: getDeps().token }));
    this.saleFetcher = new RemoteSaleFetcher(getDeps);
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
   * Pull all remote entities.
   */
  async refreshAll(forceFullSync = false): Promise<void> {
    // Run sequentially to completely avoid "cannot start a transaction within a transaction"
    // SQLite locking crashes when overlapping async operations trigger withTransactionAsync
    const fetchTasks = [
      { name: "products", task: () => this.productFetcher.fetch(forceFullSync) },
      { name: "debts", task: () => this.debtFetcher.fetch(forceFullSync) },
      { name: "shops", task: () => this.shopFetcher.fetch() },
      { name: "sales", task: () => this.saleFetcher.fetch(forceFullSync) },
      { name: "expenses", task: () => this.expenseFetcher.fetch(forceFullSync) },
      { name: "purchases", task: () => this.purchaseFetcher.fetch(forceFullSync) },
    ];

    for (const { name, task } of fetchTasks) {
      try {
        await task();
      } catch (error) {
        console.error(`Failed to fetch remote ${name}:`, error);
      }
    }
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
}
