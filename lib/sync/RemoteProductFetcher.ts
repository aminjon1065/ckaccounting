import { api, Product } from "../api";
import {
  getProductsLastSyncedAt,
  insertOrUpdateProducts,
  setProductsLastSyncedAt,
} from "../db";

export interface ProductFetcherDeps {
  token: string;
  shopId: number | undefined;
}

export class RemoteProductFetcher {
  constructor(private deps: () => ProductFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token, shopId } = this.deps();
    if (!token || !shopId) return;

    try {
      const lastSyncedAt = forceFullSync ? null : await getProductsLastSyncedAt();
      let afterId: number | null = null;
      let hasMore = true;

      while (hasMore) {
        const response = await api.products.list(token, {
          limit: 100,
          shop_id: shopId,
          updated_since: lastSyncedAt ?? undefined,
          after_id: afterId ?? undefined,
        });

        if (response.data.length > 0) {
          await insertOrUpdateProducts(response.data, shopId);
          // Cursor = last item's id; if we got a full page, there are likely more
          afterId = response.data[response.data.length - 1].id;
          hasMore = response.data.length === 100;
        } else {
          hasMore = false;
        }
      }

      if (afterId !== null || forceFullSync) {
        await setProductsLastSyncedAt(new Date().toISOString());
      }
    } catch (error) {
      console.error("Failed to fetch remote products:", error);
    }
  }
}
