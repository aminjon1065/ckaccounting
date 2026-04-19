import { api, Sale } from "../api";
import {
  getSalesLastSyncedAt,
  insertOrUpdateRemoteSales,
  setSalesLastSyncedAt,
} from "../db";

export interface SaleFetcherDeps {
  token: string;
  shopId: number | undefined;
}

export class RemoteSaleFetcher {
  constructor(private deps: () => SaleFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token, shopId } = this.deps();
    if (!token || !shopId) return;

    try {
      const lastSyncedAt = forceFullSync ? null : await getSalesLastSyncedAt();
      let afterId: number | null = null;
      let hasMore = true;

      while (hasMore) {
        const response = await api.sales.list(token, {
          limit: 100,
          updated_since: lastSyncedAt ?? undefined,
          after_id: afterId ?? undefined,
        });

        if (response.data.length > 0) {
          await insertOrUpdateRemoteSales(response.data, shopId);
          afterId = response.data[response.data.length - 1].id;
          hasMore = response.data.length === 100;
        } else {
          hasMore = false;
        }
      }

      if (afterId !== null || forceFullSync) {
        await setSalesLastSyncedAt(new Date().toISOString());
      }
    } catch (error) {
      console.error("Failed to fetch remote sales:", error);
    }
  }
}
