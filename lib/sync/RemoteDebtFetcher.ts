import { api, Debt } from "../api";
import {
  getDebtsLastSyncedAt,
  insertOrUpdateDebts,
  setDebtsLastSyncedAt,
} from "../db";

export interface DebtFetcherDeps {
  token: string;
}

export class RemoteDebtFetcher {
  constructor(private deps: () => DebtFetcherDeps) {}

  async fetch(forceFullSync = false): Promise<void> {
    const { token } = this.deps();
    if (!token) return;

    try {
      const lastSyncedAt = forceFullSync ? null : await getDebtsLastSyncedAt();
      let afterId: number | null = null;
      let hasMore = true;

      while (hasMore) {
        const response = await api.debts.list(token, {
          limit: 100,
          updated_since: lastSyncedAt ?? undefined,
          after_id: afterId ?? undefined,
        });

        if (response.data.length > 0) {
          await insertOrUpdateDebts(response.data);
          afterId = response.data[response.data.length - 1].id;
          hasMore = response.data.length === 100;
        } else {
          hasMore = false;
        }
      }

      if (afterId !== null || forceFullSync) {
        await setDebtsLastSyncedAt(new Date().toISOString());
      }
    } catch (error) {
      console.error("Failed to fetch remote debts:", error);
    }
  }
}
