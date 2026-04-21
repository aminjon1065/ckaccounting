import { api, getLastServerTime, Sale } from "../api";
import {
  getSalesLastSyncedAt,
  insertOrUpdateRemoteSales,
  setSalesLastSyncedAt,
} from "../db";

export interface SaleFetcherDeps {
  token: string;
  shopId: number | undefined;
}

/**
 * Encodes a composite (updated_at, id) cursor as base64 JSON.
 * See RemoteProductFetcher for details on the cursor protocol.
 */
function encodeCursor(updatedAt: string, id: number): string {
  return btoa(JSON.stringify({ updated_at: updatedAt, id }));
}

export class RemoteSaleFetcher {
  constructor(private deps: () => SaleFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token, shopId } = this.deps();
    if (!token || !shopId) return;

    try {
      let cursor: string | null = null;
      const lastSyncedAt = forceFullSync ? null : await getSalesLastSyncedAt();
      // Capture server_time from the FIRST response as the sync cycle's upper bound.
      let syncUntil: string | null = null;
      let hasMore = true;

      while (hasMore) {
        const response = await api.sales.list(token, {
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
          await insertOrUpdateRemoteSales(response.data, shopId);
          const lastItem = response.data[response.data.length - 1];
          cursor = encodeCursor(lastItem.updated_at, lastItem.id);
          hasMore = response.data.length === 100;
        } else {
          hasMore = false;
        }
      }

      if (cursor !== null || forceFullSync) {
        const serverTime = getLastServerTime();
        await setSalesLastSyncedAt(serverTime ?? new Date().toISOString());
      }
    } catch (error) {
      console.error("Failed to fetch remote sales:", error);
    }
  }
}
