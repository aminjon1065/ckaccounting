// ─── Aggregated-response caches ───────────────────────────────────────────────
//
// Two flat key-value tables in SQLite (`dashboard_cache`, `reports_cache`)
// hold the last successful server responses for the dashboard and report
// endpoints. They serve as the offline-fallback layer: when the user is
// online, the hook re-fetches and overwrites; when offline, the hook
// reads here and surfaces "stale" banner if past TTL.
//
// Writers in the entity repositories (sales / expenses / debts / etc)
// call `invalidateAggregatedCaches()` after every mutation that could
// shift an aggregate, so the cached totals never disagree with the
// underlying rows for longer than one transaction.
//
// `reports_cache` writers/readers are currently unused (dead code held
// for future offline-reports work), but the invalidation path covers it
// so future re-introduction won't need a separate sweep.

import { getDb } from "./schema";

const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REPORTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Drop every cached aggregate response. Cheap (a few rows max), and the
 * dashboard hook always issues a fresh API call when online — over-
 * invalidation is a safe default.
 */
export async function invalidateAggregatedCaches(): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM dashboard_cache");
  await db.runAsync("DELETE FROM reports_cache");
}

export async function setDashboardCache(key: string, data: unknown): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO dashboard_cache (key, data, fetched_at) VALUES (?, ?, ?)",
    [key, JSON.stringify(data), new Date().toISOString()]
  );
}

export async function getDashboardCache(
  key: string
): Promise<{ data: unknown; fetched_at: string; stale?: boolean } | null> {
  const db = getDb();
  const r = await db.getFirstAsync<{ key: string; data: string; fetched_at: string }>(
    "SELECT * FROM dashboard_cache WHERE key = ?",
    [key]
  );
  if (!r) return null;
  try {
    const fetchedAt = new Date(r.fetched_at).getTime();
    const now = Date.now();
    const stale = now - fetchedAt > DASHBOARD_CACHE_TTL_MS;
    return { data: JSON.parse(r.data), fetched_at: r.fetched_at, stale };
  } catch {
    return null;
  }
}

export async function setReportsCache(type: string, dateRange: string, data: unknown): Promise<void> {
  const db = getDb();
  const key = `${type}:${dateRange}`;
  await db.runAsync(
    "INSERT OR REPLACE INTO reports_cache (key, data, fetched_at) VALUES (?, ?, ?)",
    [key, JSON.stringify(data), new Date().toISOString()]
  );
}

export async function getReportsCache(
  type: string,
  dateRange: string
): Promise<{ data: unknown; fetched_at: string; stale?: boolean } | null> {
  const db = getDb();
  const key = `${type}:${dateRange}`;
  const r = await db.getFirstAsync<{ key: string; data: string; fetched_at: string }>(
    "SELECT * FROM reports_cache WHERE key = ?",
    [key]
  );
  if (!r) return null;
  try {
    const fetchedAt = new Date(r.fetched_at).getTime();
    const now = Date.now();
    const stale = now - fetchedAt > REPORTS_CACHE_TTL_MS;
    return { data: JSON.parse(r.data), fetched_at: r.fetched_at, stale };
  } catch {
    return null;
  }
}
