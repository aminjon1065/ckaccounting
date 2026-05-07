import { api, getLastServerTime, Purchase } from "../api";
import {
  getPurchasesLastSyncedAt,
  getSyncMetadata,
  insertOrUpdatePurchases,
  setPurchasesLastSyncedAt,
  setSyncMetadata,
} from "../db";
import { reportError } from "@/lib/observability/reporter";
import { encodeCursor } from "./cursor";

export interface PurchaseFetcherDeps {
  token: string;
}

const INITIAL_SYNC_PAGE_LIMIT = 5;
const PAGE_SIZE = 100;
const OLDEST_KEY = "purchases_oldest_synced_at";

export class RemotePurchaseFetcher {
  constructor(private deps: () => PurchaseFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token } = this.deps();
    if (!token) return;

    try {
      let cursor: string | null = null;
      const lastSyncedAt = forceFullSync ? null : await getPurchasesLastSyncedAt();
      const isFirstSync = lastSyncedAt === null;
      let syncUntil: string | null = null;
      let hasMore = true;
      let pagesFetched = 0;
      let lastItemUpdatedAt: string | null = null;

      while (hasMore) {
        const response = await api.purchases.list(token, {
          limit: PAGE_SIZE,
          cursor: cursor ?? undefined,
          updated_since: cursor === null ? (lastSyncedAt ?? undefined) : undefined,
          updated_before: syncUntil ?? undefined,
        });

        if (syncUntil === null) {
          syncUntil = getLastServerTime() ?? null;
        }

        if (response.data.length > 0) {
          await insertOrUpdatePurchases(response.data);
          const lastItem = response.data[response.data.length - 1];
          cursor = encodeCursor(lastItem.updated_at, lastItem.id);
          lastItemUpdatedAt = lastItem.updated_at;
          hasMore = response.data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }

        pagesFetched++;
        if (isFirstSync && pagesFetched >= INITIAL_SYNC_PAGE_LIMIT) {
          break;
        }
      }

      const serverTime = getLastServerTime();
      await setPurchasesLastSyncedAt(serverTime ?? new Date().toISOString());

      if (isFirstSync && lastItemUpdatedAt) {
        await setSyncMetadata(OLDEST_KEY, lastItemUpdatedAt);
      }
    } catch (error) {
      reportError(error, { tag: "remote-fetcher", entity: "purchases" });
    }
  }

  async fetchOlder(pages = 5): Promise<boolean> {
    const { token } = this.deps();
    if (!token) return false;

    const oldest = await getSyncMetadata(OLDEST_KEY);
    if (!oldest) return false;

    try {
      let upperBound = oldest;
      let pagesPulled = 0;
      let lastItemUpdatedAt: string | null = null;

      while (pagesPulled < pages) {
        const response = await api.purchases.list(token, {
          limit: PAGE_SIZE,
          updated_before: upperBound,
        });

        if (response.data.length === 0) {
          await setSyncMetadata(OLDEST_KEY, "1970-01-01T00:00:00.000Z");
          return false;
        }

        await insertOrUpdatePurchases(response.data as Purchase[]);
        const lastItem = response.data[response.data.length - 1];
        lastItemUpdatedAt = lastItem.updated_at;
        upperBound = lastItem.updated_at;
        pagesPulled++;

        if (response.data.length < PAGE_SIZE) {
          await setSyncMetadata(OLDEST_KEY, lastItemUpdatedAt);
          return false;
        }
      }

      if (lastItemUpdatedAt) {
        await setSyncMetadata(OLDEST_KEY, lastItemUpdatedAt);
      }
      return true;
    } catch (error) {
      reportError(error, { tag: "remote-fetcher", entity: "purchases", op: "fetch-older" });
      return false;
    }
  }
}
