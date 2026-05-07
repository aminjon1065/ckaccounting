import { api, getLastServerTime, Sale } from "../api";
import {
  getDb,
  getSalesLastSyncedAt,
  getSyncMetadata,
  insertOrUpdateRemoteSales,
  setSalesLastSyncedAt,
  setSyncMetadata,
} from "../db";
import { reportError } from "@/lib/observability/reporter";
import { encodeCursor } from "./cursor";

export interface SaleFetcherDeps {
  token: string;
  shopId: number | undefined;
  role?: string;
  userId?: number;
}

/**
 * Sales accumulate forever. Pulling thousands on first launch blocks the
 * UI for a long time and most of those rows aren't visible. Cap initial
 * sync at the most recent slice; older history is fetched on demand via
 * fetchOlder() when the user scrolls past the local window.
 */
const INITIAL_SYNC_PAGE_LIMIT = 5;
const PAGE_SIZE = 100;
const OLDEST_KEY = "sales_oldest_synced_at";

export class RemoteSaleFetcher {
  constructor(private deps: () => SaleFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token, shopId } = this.deps();
    // shopId is optional — super-admins (no shop assignment) get the cross-
    // shop set straight from the server, owners/sellers always have a
    // shopId from auth.user. The API filters by the auth token's role.
    if (!token) return;

    try {
      let cursor: string | null = null;
      const lastSyncedAt = forceFullSync ? null : await getSalesLastSyncedAt();
      const isFirstSync = lastSyncedAt === null;
      // Capture server_time from the FIRST response as the sync cycle's upper bound.
      let syncUntil: string | null = null;
      let hasMore = true;
      let pagesFetched = 0;
      let lastItemUpdatedAt: string | null = null;

      while (hasMore) {
        const response = await api.sales.list(token, {
          limit: PAGE_SIZE,
          cursor: cursor ?? undefined,
          updated_since: cursor === null ? (lastSyncedAt ?? undefined) : undefined,
          updated_before: syncUntil ?? undefined,
        });

        if (syncUntil === null) {
          syncUntil = getLastServerTime() ?? null;
        }

        if (response.data.length > 0) {
          await insertOrUpdateRemoteSales(response.data, shopId);
          const lastItem = response.data[response.data.length - 1];
          cursor = encodeCursor(lastItem.updated_at, lastItem.id);
          lastItemUpdatedAt = lastItem.updated_at;
          hasMore = response.data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }

        pagesFetched++;
        // Cap initial sync — older history loads later via fetchOlder().
        if (isFirstSync && pagesFetched >= INITIAL_SYNC_PAGE_LIMIT) {
          break;
        }
      }

      const serverTime = getLastServerTime();
      await setSalesLastSyncedAt(serverTime ?? new Date().toISOString());

      // Persist the lower boundary so fetchOlder() knows where to continue.
      // Only set on first sync OR when an existing oldest is missing — delta
      // pulls don't touch this value (they only bring newer records in).
      if (isFirstSync && lastItemUpdatedAt) {
        await setSyncMetadata(OLDEST_KEY, lastItemUpdatedAt);
      }

      // Clean up cross-user sales for Seller role
      const { role, userId, shopId: currentShopId } = this.deps();
      if (role === "seller" && userId && currentShopId) {
        const db = getDb();
        await db.runAsync(
          "DELETE FROM sales WHERE user_id IS NOT NULL AND user_id != ? AND shop_id = ?",
          [userId, currentShopId]
        );
      }
    } catch (error) {
      reportError(error, { tag: "remote-fetcher", entity: "sales" });
    }
  }

  /**
   * Pull one more historical page below the current local window.
   * Returns true if more history is still available on the server.
   */
  async fetchOlder(pages = 5): Promise<boolean> {
    const { token, shopId } = this.deps();
    if (!token) return false;

    const oldest = await getSyncMetadata(OLDEST_KEY);
    if (!oldest) return false;

    try {
      let upperBound = oldest;
      let pagesPulled = 0;
      let lastItemUpdatedAt: string | null = null;

      while (pagesPulled < pages) {
        const response = await api.sales.list(token, {
          limit: PAGE_SIZE,
          updated_before: upperBound,
        });

        if (response.data.length === 0) {
          await setSyncMetadata(OLDEST_KEY, "1970-01-01T00:00:00.000Z");
          return false;
        }

        await insertOrUpdateRemoteSales(response.data as Sale[], shopId);
        const lastItem = response.data[response.data.length - 1];
        lastItemUpdatedAt = lastItem.updated_at;
        upperBound = lastItem.updated_at;
        pagesPulled++;

        if (response.data.length < PAGE_SIZE) {
          // Server has nothing older.
          await setSyncMetadata(OLDEST_KEY, lastItemUpdatedAt);
          return false;
        }
      }

      if (lastItemUpdatedAt) {
        await setSyncMetadata(OLDEST_KEY, lastItemUpdatedAt);
      }
      return true;
    } catch (error) {
      reportError(error, { tag: "remote-fetcher", entity: "sales", op: "fetch-older" });
      return false;
    }
  }
}
