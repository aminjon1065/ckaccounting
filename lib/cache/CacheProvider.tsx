// ─── Cache provider ──────────────────────────────────────────────────────────
//
// Online-first replacement for the old SyncProvider. Owns the read-side cache:
// it pulls fresh data from the server into local SQLite so screens that read
// from the cache see something instantly on cold-launch and during brief
// offline periods. There is no outbox here — writes go straight to the server
// (see Phase 1 migration). There is no conflict resolution here — writes are
// authoritative on the server.
//
// What this owns:
//   • 6 fetcher instances, one per entity, with auth wired via a ref
//   • A periodic background pull (every 60 s when online + authed)
//   • A single in-flight promise for refresh, dedupes parallel callers
//   • Methods exposed to the UI: triggerSync, refreshProducts, fetchOlder*,
//     fetchAllHistory
//
// What it does NOT own:
//   • Network state — that lives in `lib/network/NetworkProvider`
//   • Outbox / dead-letter queue — deleted in Phase 2
//   • Conflict resolution / version bookkeeping — deleted in Phase 2
//   • Background-fetch (OS background task) — deleted in Phase 2; the periodic
//     timer here covers foreground refresh

import * as React from "react";
import { create } from "zustand";

import { useAuth } from "@/store/auth";
import { useIsOnline } from "@/lib/network/NetworkProvider";
import { reportError } from "@/lib/observability/reporter";
import { checkAndNotifyLowStock } from "@/lib/db";

import { RemoteProductFetcher } from "./fetchers/ProductFetcher";
import { RemoteSaleFetcher } from "./fetchers/SaleFetcher";
import { RemoteDebtFetcher } from "./fetchers/DebtFetcher";
import { RemoteShopFetcher } from "./fetchers/ShopFetcher";
import { RemoteExpenseFetcher } from "./fetchers/ExpenseFetcher";
import { RemotePurchaseFetcher } from "./fetchers/PurchaseFetcher";

// ─── State store (UI subscribes via selector hooks) ──────────────────────────

export type HistoryEntity =
  | "products"
  | "shops"
  | "debts"
  | "sales"
  | "expenses"
  | "purchases";

export interface HistoryProgress {
  entity: HistoryEntity;
  pagesPulled: number;
}

interface CacheState {
  isSyncing: boolean;
  lastSyncedAt: Date | null;
}

export const useCacheStore = create<CacheState>(() => ({
  isSyncing: false,
  lastSyncedAt: null,
}));

export const useIsSyncing = () => useCacheStore((s) => s.isSyncing);
export const useLastSyncedAt = () => useCacheStore((s) => s.lastSyncedAt);

// ─── Methods context ─────────────────────────────────────────────────────────

export interface CacheMethods {
  /** Pull all entities once. Coalesces concurrent callers onto a single promise. */
  triggerSync: () => Promise<boolean>;
  refreshProducts: (forceFullSync?: boolean) => Promise<void>;
  fetchRemoteDebts: () => Promise<void>;
  fetchRemoteShops: () => Promise<void>;
  fetchOlderSales: (pages?: number) => Promise<boolean>;
  fetchOlderExpenses: (pages?: number) => Promise<boolean>;
  fetchOlderPurchases: (pages?: number) => Promise<boolean>;
  fetchAllHistory: (onProgress?: (s: HistoryProgress) => void) => Promise<void>;
}

const noopMethods: CacheMethods = {
  triggerSync: async () => false,
  refreshProducts: async () => {},
  fetchRemoteDebts: async () => {},
  fetchRemoteShops: async () => {},
  fetchOlderSales: async () => false,
  fetchOlderExpenses: async () => false,
  fetchOlderPurchases: async () => false,
  fetchAllHistory: async () => {},
};

const CacheMethodsContext = React.createContext<CacheMethods>(noopMethods);

// ─── Provider ────────────────────────────────────────────────────────────────

const PERIODIC_REFRESH_MS = 60_000;

export function CacheProvider({ children }: { children: React.ReactNode }) {
  const { token, user, tokenExpired } = useAuth();
  const isOnline = useIsOnline();

  const authRef = React.useRef({
    token: token ?? "",
    shopId: user?.shop_id,
    role: user?.role,
    userId: user?.id,
  });
  authRef.current = {
    token: token ?? "",
    shopId: user?.shop_id,
    role: user?.role,
    userId: user?.id,
  };

  const tokenRef = React.useRef<string | null>(null);
  const tokenExpiredRef = React.useRef(false);
  tokenRef.current = token;
  tokenExpiredRef.current = tokenExpired;

  // Fetchers built once for the lifetime of the provider. Each reads auth
  // through `authRef` so a token refresh or shop switch propagates without
  // requiring a new fetcher instance.
  const fetchers = React.useRef({
    products: new RemoteProductFetcher(() => authRef.current),
    sales: new RemoteSaleFetcher(() => authRef.current),
    debts: new RemoteDebtFetcher(() => ({ token: authRef.current.token })),
    shops: new RemoteShopFetcher(() => ({ token: authRef.current.token })),
    expenses: new RemoteExpenseFetcher(() => ({ token: authRef.current.token })),
    purchases: new RemotePurchaseFetcher(() => ({ token: authRef.current.token })),
  });

  // Single in-flight promise for triggerSync. Concurrent callers (pull-to-
  // refresh + periodic timer + reconnect) all attach to the same pull instead
  // of stacking up parallel API floods.
  const inflightRef = React.useRef<Promise<boolean> | null>(null);

  const runFullRefresh = React.useCallback(async (forceFullSync = false): Promise<boolean> => {
    if (!isOnline || !tokenRef.current || tokenExpiredRef.current) return false;

    useCacheStore.setState({ isSyncing: true });
    try {
      const isSeller = authRef.current.role === "seller";
      const tasks: Array<{ name: string; task: () => Promise<unknown> }> = [
        { name: "products", task: () => fetchers.current.products.fetch(forceFullSync) },
        { name: "shops", task: () => fetchers.current.shops.fetch(forceFullSync) },
        { name: "debts", task: () => fetchers.current.debts.fetch(forceFullSync) },
        { name: "sales", task: () => fetchers.current.sales.fetch(forceFullSync) },
      ];
      if (!isSeller) {
        tasks.push(
          { name: "expenses", task: () => fetchers.current.expenses.fetch(forceFullSync) },
          { name: "purchases", task: () => fetchers.current.purchases.fetch(forceFullSync) }
        );
      }

      // expo-sqlite serializes writes internally, so parallel fetches are
      // safe and ~6x faster than sequential on cold start.
      const results = await Promise.allSettled(tasks.map((t) => t.task()));
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          reportError(r.reason, { tag: "cache-refresh", entity: tasks[i].name });
        }
      });

      useCacheStore.setState({ lastSyncedAt: new Date() });
      return true;
    } finally {
      useCacheStore.setState({ isSyncing: false });
    }
  }, [isOnline]);

  const triggerSync = React.useCallback(async (): Promise<boolean> => {
    if (inflightRef.current) return inflightRef.current;
    const p = runFullRefresh(false).finally(() => {
      inflightRef.current = null;
    });
    inflightRef.current = p;
    return p;
  }, [runFullRefresh]);

  const refreshProducts = React.useCallback(async (forceFullSync = false): Promise<void> => {
    if (!isOnline || !tokenRef.current || tokenExpiredRef.current) return;
    try {
      await fetchers.current.products.fetch(forceFullSync);
    } catch (e) {
      reportError(e, { tag: "cache-refresh", entity: "products" });
    }
  }, [isOnline]);

  const fetchRemoteDebts = React.useCallback(async (): Promise<void> => {
    if (!isOnline || !tokenRef.current || tokenExpiredRef.current) return;
    try {
      await fetchers.current.debts.fetch();
    } catch (e) {
      reportError(e, { tag: "cache-refresh", entity: "debts" });
    }
  }, [isOnline]);

  const fetchRemoteShops = React.useCallback(async (): Promise<void> => {
    if (!isOnline || !tokenRef.current || tokenExpiredRef.current) return;
    try {
      await fetchers.current.shops.fetch();
    } catch (e) {
      reportError(e, { tag: "cache-refresh", entity: "shops" });
    }
  }, [isOnline]);

  const fetchOlderSales = React.useCallback(async (pages = 5): Promise<boolean> => {
    if (!isOnline || !tokenRef.current || tokenExpiredRef.current) return false;
    return fetchers.current.sales.fetchOlder(pages);
  }, [isOnline]);

  const fetchOlderExpenses = React.useCallback(async (pages = 5): Promise<boolean> => {
    if (!isOnline || !tokenRef.current || tokenExpiredRef.current) return false;
    return fetchers.current.expenses.fetchOlder(pages);
  }, [isOnline]);

  const fetchOlderPurchases = React.useCallback(async (pages = 5): Promise<boolean> => {
    if (!isOnline || !tokenRef.current || tokenExpiredRef.current) return false;
    return fetchers.current.purchases.fetchOlder(pages);
  }, [isOnline]);

  const fetchAllHistory = React.useCallback(
    async (onProgress?: (s: HistoryProgress) => void): Promise<void> => {
      if (!isOnline || !tokenRef.current || tokenExpiredRef.current) return;

      const PAGE_CHUNK = 5;
      const MAX_CHUNKS = 200;
      const isSeller = authRef.current.role === "seller";

      // Stage 1: seed local data + oldest cursor for every entity.
      await fetchers.current.products.fetch(true);
      onProgress?.({ entity: "products", pagesPulled: 1 });

      await fetchers.current.shops.fetch(true);
      onProgress?.({ entity: "shops", pagesPulled: 1 });

      await fetchers.current.debts.fetch(true);
      onProgress?.({ entity: "debts", pagesPulled: 1 });

      await fetchers.current.sales.fetch(true);
      onProgress?.({ entity: "sales", pagesPulled: PAGE_CHUNK });

      if (!isSeller) {
        await fetchers.current.expenses.fetch(true);
        onProgress?.({ entity: "expenses", pagesPulled: PAGE_CHUNK });

        await fetchers.current.purchases.fetch(true);
        onProgress?.({ entity: "purchases", pagesPulled: PAGE_CHUNK });
      }

      // Stage 2: drain older history for cursor-paginated entities.
      const drain = async (
        entity: HistoryEntity,
        fn: (pages: number) => Promise<boolean>,
        seed: number,
      ) => {
        let pagesPulled = seed;
        for (let i = 0; i < MAX_CHUNKS; i++) {
          const more = await fn(PAGE_CHUNK);
          pagesPulled += PAGE_CHUNK;
          onProgress?.({ entity, pagesPulled });
          if (!more) break;
        }
      };

      await drain("sales", (p) => fetchers.current.sales.fetchOlder(p), PAGE_CHUNK);
      if (!isSeller) {
        await drain("expenses", (p) => fetchers.current.expenses.fetchOlder(p), PAGE_CHUNK);
        await drain("purchases", (p) => fetchers.current.purchases.fetchOlder(p), PAGE_CHUNK);
      }
    },
    [isOnline]
  );

  // ─── Lifecycle: pull on (online && authed), then periodically ──────────────

  React.useEffect(() => {
    if (!isOnline || !token || tokenExpired) return;

    // Initial pull on (re)connect. If a pull is already in flight (e.g. from
    // a recent triggerSync), this attaches to it instead of spawning another.
    triggerSync().catch(() => {});

    // Low-stock check fires shortly after products refresh — gives the
    // fetcher time to write the freshest values before we read them.
    const lowStockTimer = setTimeout(() => {
      if (authRef.current.shopId) {
        checkAndNotifyLowStock(authRef.current.shopId).catch((e) =>
          reportError(e, { tag: "cache-low-stock" })
        );
      }
    }, 2_000);

    const interval = setInterval(() => {
      triggerSync().catch(() => {});
    }, PERIODIC_REFRESH_MS);

    return () => {
      clearTimeout(lowStockTimer);
      clearInterval(interval);
    };
  }, [isOnline, token, tokenExpired, triggerSync]);

  // ─── Methods context value ─────────────────────────────────────────────────

  const methods = React.useMemo<CacheMethods>(
    () => ({
      triggerSync,
      refreshProducts,
      fetchRemoteDebts,
      fetchRemoteShops,
      fetchOlderSales,
      fetchOlderExpenses,
      fetchOlderPurchases,
      fetchAllHistory,
    }),
    [
      triggerSync,
      refreshProducts,
      fetchRemoteDebts,
      fetchRemoteShops,
      fetchOlderSales,
      fetchOlderExpenses,
      fetchOlderPurchases,
      fetchAllHistory,
    ]
  );

  return <CacheMethodsContext.Provider value={methods}>{children}</CacheMethodsContext.Provider>;
}

// ─── Public hook ─────────────────────────────────────────────────────────────

export function useCacheMethods(): CacheMethods {
  return React.useContext(CacheMethodsContext);
}
