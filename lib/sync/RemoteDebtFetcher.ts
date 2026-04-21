import { api, getLastServerTime, Debt } from "../api";
import {
  getDebtsLastSyncedAt,
  insertOrUpdateDebts,
  setDebtsLastSyncedAt,
} from "../db";

export interface DebtFetcherDeps {
  token: string;
}

function encodeCursor(updatedAt: string, id: number): string {
  return btoa(JSON.stringify({ updated_at: updatedAt, id }));
}

export class RemoteDebtFetcher {
  constructor(private deps: () => DebtFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token } = this.deps();
    if (!token) return;

    try {
      let cursor: string | null = null;
      const lastSyncedAt = forceFullSync ? null : await getDebtsLastSyncedAt();
      // Capture server_time from the FIRST response as the sync cycle's upper bound.
      let syncUntil: string | null = null;
      let hasMore = true;

      while (hasMore) {
        const response = await api.debts.list(token, {
          limit: 100,
          cursor: cursor ?? undefined,
          updated_since: cursor === null ? (lastSyncedAt ?? undefined) : undefined,
          updated_before: syncUntil ?? undefined,
        });

        // Capture server_time from the very first response as the high-water mark.
        if (syncUntil === null) {
          syncUntil = getLastServerTime() ?? null;
        }

        if (response.data.length > 0) {
          await insertOrUpdateDebts(response.data);
          const lastItem = response.data[response.data.length - 1];
          cursor = encodeCursor(lastItem.updated_at, lastItem.id);
          hasMore = response.data.length === 100;
        } else {
          hasMore = false;
        }
      }

      if (cursor !== null || forceFullSync) {
        const serverTime = getLastServerTime();
        await setDebtsLastSyncedAt(serverTime ?? new Date().toISOString());
      }
    } catch (error) {
      console.error("Failed to fetch remote debts:", error);
    }
  }
}
