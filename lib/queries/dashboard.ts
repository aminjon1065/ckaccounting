// ─── Dashboard query ────────────────────────────────────────────────────────
//
// Single read-only query for the home screen. Filter combinations
// (period / shop_id / custom date range) each get their own cache slot
// so switching between them is instant on warm cache.
//
// Every other domain's mutation invalidates `['dashboard']` so the home
// screen reactively reflects new sales / purchases / debts / expenses
// without manual refetch wiring.
//
// Offline fallback: if the network is down and we have a cached row in
// SQLite, surface that snapshot via the React Query error path. The
// in-memory cache is otherwise the source of truth; SQLite is the cold-
// launch / disconnected safety net.

import { useQuery } from "@tanstack/react-query";

import {
  api,
  ApiError,
  type DashboardPeriod,
  type DashboardSummary,
} from "@/lib/api";
import { getDashboardCache, setDashboardCache } from "@/lib/db";

// ─── Keys ────────────────────────────────────────────────────────────────────

export interface DashboardFilters {
  period: DashboardPeriod;
  shopId: number | null;
  dateFrom: string | null;
  dateTo: string | null;
}

function normaliseFilters(f: DashboardFilters) {
  return {
    period: f.period,
    shopId: f.shopId ?? null,
    dateFrom: f.dateFrom ?? null,
    dateTo: f.dateTo ?? null,
  };
}

export const dashboardKeys = {
  all: ["dashboard"] as const,
  summary: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "summary", normaliseFilters(filters)] as const,
};

function cacheKeyFor(filters: DashboardFilters): string {
  const f = normaliseFilters(filters);
  return `dashboard_${f.period}_${f.shopId ?? "all"}_${f.dateFrom ?? ""}_${f.dateTo ?? ""}`;
}

// ─── Result wrapper ─────────────────────────────────────────────────────────
//
// We attach a `_meta.fromCache` flag so the screen can render the offline
// banner without sprinkling its own offline-detection logic.

export interface DashboardResult {
  summary: DashboardSummary;
  fromCache: boolean;
  cacheAgeMinutes: number | null;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useDashboardSummary(
  token: string | null,
  filters: DashboardFilters,
) {
  return useQuery<DashboardResult>({
    queryKey: dashboardKeys.summary(filters),
    enabled: !!token,
    // The dashboard payload is heavier than a typical list and the user
    // expects "always fresh" feel — but we still avoid hammering. 15s
    // gives enough cushion that flipping period filters is instant,
    // while a return-from-debt-detail (typical 30s+ round trip) always
    // refetches.
    staleTime: 15_000,
    // Background refetch on screen focus (RN AppState foreground)
    // is wired by QueryProvider.
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const key = cacheKeyFor(filters);
      try {
        const summary = await api.dashboard.summary(
          filters.period,
          token!,
          filters.shopId ?? undefined,
          filters.dateFrom ?? undefined,
          filters.dateTo ?? undefined,
        );
        // Mirror to SQLite so a cold offline launch still has data.
        setDashboardCache(key, summary).catch(() => {});
        return { summary, fromCache: false, cacheAgeMinutes: null };
      } catch (err) {
        // Network-level failure → fall back to the SQLite snapshot. Other
        // errors (4xx / 5xx) bubble up as a real query error so the screen
        // can show "Ошибка загрузки" instead of stale numbers.
        const isNetwork = err instanceof ApiError && err.status === 0;
        if (!isNetwork) throw err;

        const cached = await getDashboardCache(key).catch(() => null);
        if (!cached) throw err;

        const ageMinutes = Math.round(
          (Date.now() - new Date(cached.fetched_at).getTime()) / 60000,
        );
        return {
          summary: cached.data as DashboardSummary,
          fromCache: true,
          cacheAgeMinutes: cached.stale ? ageMinutes : null,
        };
      }
    },
  });
}
