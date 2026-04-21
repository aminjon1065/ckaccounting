import { api, getLastServerTime, Product } from "../api";
import {
  getProductsLastSyncedAt,
  insertOrUpdateProducts,
  setProductsLastSyncedAt,
} from "../db";

export interface ProductFetcherDeps {
  token: string;
  shopId: number | undefined;
}

/**
 * Encodes a composite (updated_at, id) cursor as base64 JSON.
 * This provides stable, duplicate-free pagination when combined with
 * ORDER BY updated_at DESC, id DESC on the server.
 */
function encodeCursor(updatedAt: string, id: number): string {
  return btoa(JSON.stringify({ updated_at: updatedAt, id }));
}

export class RemoteProductFetcher {
  constructor(private deps: () => ProductFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token, shopId } = this.deps();
    if (!token || !shopId) return;

    try {
      // For full sync: reset cursor so we fetch everything ordered by updated_at DESC
      // For incremental sync: last_synced_at is used as a server-side high-water mark
      let cursor: string | null = null;
      const lastSyncedAt = forceFullSync ? null : await getProductsLastSyncedAt();

      // Capture server_time from the FIRST response as the sync cycle's upper bound.
      // Using the same updated_before for all pages prevents records written during
      // a long sync from being split across pages (clock skew protection).
      let syncUntil: string | null = null;

      // If we have a lastSyncedAt, use it as the starting point for a stable cursor.
      // The server will return records updated since that timestamp, ordered DESC.
      // We then paginate using cursor tokens extracted from each response.
      let hasMore = true;

      while (hasMore) {
        const response = await api.products.list(token, {
          limit: 100,
          shop_id: shopId,
          // Pass cursor (preferred) for duplicate-free pagination.
          // For first page in incremental sync, use updated_since as lower bound.
          cursor: cursor ?? undefined,
          updated_since: cursor === null ? (lastSyncedAt ?? undefined) : undefined,
          // Upper bound: fixed at cycle start so all pages see the same snapshot.
          updated_before: syncUntil ?? undefined,
        });

        // Capture server_time from the very first response as the high-water mark.
        // This value is used as updated_before for subsequent pages in this cycle.
        if (syncUntil === null) {
          syncUntil = getLastServerTime() ?? null;
        }

        if (response.data.length > 0) {
          await insertOrUpdateProducts(response.data, shopId);

          // Extract cursor from the last item for the next page.
          // The cursor encodes (updated_at, id) of the last item in this page,
          // which the server uses to determine the next page's starting position.
          const lastItem = response.data[response.data.length - 1];
          cursor = encodeCursor(lastItem.updated_at, lastItem.id);
          hasMore = response.data.length === 100;
        } else {
          hasMore = false;
        }
      }

      // After a full cycle with no errors, persist the server's high-water mark.
      // Use server_time from the API response — not device clock — to avoid
      // clock skew causing missed records on subsequent syncs.
      if (cursor !== null || forceFullSync) {
        const serverTime = getLastServerTime();
        await setProductsLastSyncedAt(serverTime ?? new Date().toISOString());
      }
    } catch (error) {
      console.error("Failed to fetch remote products:", error);
    }
  }
}
