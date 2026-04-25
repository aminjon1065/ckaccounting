import { api, getLastServerTime, Expense } from "../api";
import {
  getExpensesLastSyncedAt,
  insertOrUpdateExpenses,
  setExpensesLastSyncedAt,
} from "../db";

export interface ExpenseFetcherDeps {
  token: string;
}

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
      let syncUntil: string | null = null;
      let hasMore = true;

      while (hasMore) {
        const response = await api.expenses.list(token, {
          limit: 100,
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
          hasMore = response.data.length === 100;
        } else {
          hasMore = false;
        }
      }

      const serverTime = getLastServerTime();
      await setExpensesLastSyncedAt(serverTime ?? new Date().toISOString());
    } catch (error) {
      console.error("Failed to fetch remote expenses:", error);
    }
  }
}
