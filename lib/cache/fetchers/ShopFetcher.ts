import { api, getLastServerTime } from "../../api";
import {
  getShopsLastSyncedAt,
  insertOrUpdateShops,
  reconcileLocalShops,
  setShopsLastSyncedAt,
} from "../../db";
import { reportError } from "@/lib/observability/reporter";

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
          await insertOrUpdateShops(response.data);
        }

        const lastPage = response.meta?.last_page;
        if ((lastPage !== undefined && page >= lastPage) || response.data.length === 0) {
          hasMore = false;
        } else {
          page++;
        }
      }

      const serverTime = getLastServerTime();
      await setShopsLastSyncedAt(serverTime ?? new Date().toISOString());
    } catch (error) {
      reportError(error, { tag: "remote-fetcher", entity: "shops" });
    }
  }

  /**
   * Lightweight ghost-eviction: fetch every shop id the actor can see via
   * the dedicated `/shops/ids` endpoint and prune local rows whose id is
   * absent. This catches server-side hard-deletes that can never reach the
   * delta sync (no tombstone is emitted for hard-deletes).
   *
   * Cheap to call frequently — payload is `{id, updated_at}` per shop, not
   * full rows. Pair with `fetch()` (delta) to keep details fresh: this method
   * doesn't pull names, owners, or status.
   */
  async reconcile(): Promise<void> {
    const { token } = this.deps();
    if (!token) return;

    try {
      const rows = await api.shops.ids(token);
      const ids = rows.map((r) => r.id);
      await reconcileLocalShops(ids);
    } catch (error) {
      reportError(error, { tag: "remote-fetcher", entity: "shops", op: "reconcile" });
    }
  }
}
