import { api, getLastServerTime } from "../api";
import {
  getShopsLastSyncedAt,
  insertOrUpdateShops,
  setShopsLastSyncedAt,
} from "../db";

export interface ShopFetcherDeps {
  token: string;
}

export class RemoteShopFetcher {
  constructor(private deps: () => ShopFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token } = this.deps();
    if (!token) return;

    try {
      const lastSyncedAt = forceFullSync ? null : await getShopsLastSyncedAt();
      let syncUntil: string | null = null;
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await api.shops.list(token, {
          page,
          limit: 100,
          updated_since: lastSyncedAt ?? undefined,
          updated_before: syncUntil ?? undefined,
        });

        if (syncUntil === null) {
          syncUntil = getLastServerTime();
        }

        if (response.data.length > 0) {
          await insertOrUpdateShops(response.data as any);
        }

        if (page >= response.meta.last_page || response.data.length === 0) {
          hasMore = false;
        } else {
          page++;
        }
      }

      const serverTime = getLastServerTime();
      await setShopsLastSyncedAt(serverTime ?? new Date().toISOString());
    } catch (error) {
      console.error("Failed to fetch remote shops:", error);
    }
  }
}
