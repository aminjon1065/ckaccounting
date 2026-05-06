import { api, getLastServerTime, Expense } from "../api";
import {
  getExpensesLastSyncedAt,
  getSyncMetadata,
  insertOrUpdateExpenses,
  setExpensesLastSyncedAt,
  setSyncMetadata,
} from "../db";

export interface ExpenseFetcherDeps {
  token: string;
}

const INITIAL_SYNC_PAGE_LIMIT = 5;
const PAGE_SIZE = 100;
const OLDEST_KEY = "expenses_oldest_synced_at";

function encodeCursor(updatedAt: string, id: number): string {
  return btoa(JSON.stringify({ updated_at: updatedAt, id }));
}

export class RemoteExpenseFetcher {
  constructor(private deps: () => ExpenseFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token } = this.deps();
    if (!token) return;

    try {
      let cursor: string | null = null;
      const lastSyncedAt = forceFullSync ? null : await getExpensesLastSyncedAt();
      const isFirstSync = lastSyncedAt === null;
      let syncUntil: string | null = null;
      let hasMore = true;
      let pagesFetched = 0;
      let lastItemUpdatedAt: string | null = null;

      while (hasMore) {
        const response = await api.expenses.list(token, {
          limit: PAGE_SIZE,
          cursor: cursor ?? undefined,
          updated_since: cursor === null ? (lastSyncedAt ?? undefined) : undefined,
          updated_before: syncUntil ?? undefined,
        });

        if (syncUntil === null) {
          syncUntil = getLastServerTime() ?? null;
        }

        if (response.data.length > 0) {
          await insertOrUpdateExpenses(response.data);
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
      await setExpensesLastSyncedAt(serverTime ?? new Date().toISOString());

      if (isFirstSync && lastItemUpdatedAt) {
        await setSyncMetadata(OLDEST_KEY, lastItemUpdatedAt);
      }
    } catch (error) {
      console.error("Failed to fetch remote expenses:", error);
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
        const response = await api.expenses.list(token, {
          limit: PAGE_SIZE,
          updated_before: upperBound,
        });

        if (response.data.length === 0) {
          await setSyncMetadata(OLDEST_KEY, "1970-01-01T00:00:00.000Z");
          return false;
        }

        await insertOrUpdateExpenses(response.data as Expense[]);
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
      console.error("Failed to fetch older expenses:", error);
      return false;
    }
  }
}
