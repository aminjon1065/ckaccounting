import { api, Shop } from "../api";
import { insertOrUpdateShop } from "../db";

export interface ShopFetcherDeps {
  token: string;
}

export class RemoteShopFetcher {
  constructor(private deps: () => ShopFetcherDeps) {}

  async fetch(): Promise<void> {
    const { token } = this.deps();
    if (!token) return;

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await api.shops.list(token, { page, limit: 100 });

        if (response.data.length > 0) {
          for (const shop of response.data) {
            await insertOrUpdateShop(shop, String(shop.id));
          }
          page++;
          if (page > response.meta.last_page) hasMore = false;
        } else {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error("Failed to fetch remote shops:", error);
    }
  }
}
