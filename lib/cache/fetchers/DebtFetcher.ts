import { api, getLastServerTime } from "../../api";
import {
  getDebtsLastSyncedAt,
  insertOrUpdateDebts,
  setDebtsLastSyncedAt,
} from "../../db";
import { reportError } from "@/lib/observability/reporter";
import { encodeCursor } from "../cursor";

export interface DebtFetcherDeps {
  token: string;
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
      reportError(error, { tag: "remote-fetcher", entity: "debts" });
    }
  }
}
