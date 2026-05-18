// ─── TanStack Query client ──────────────────────────────────────────────────
//
// Single QueryClient instance for the app. Configured for an online-first
// flow with smart retries and stale-while-revalidate caching.
//
// Defaults rationale:
//   • staleTime 30s — short window where we trust the cache without a
//     background refetch. Long enough that tab-switches feel instant,
//     short enough that lists refresh themselves a few moments after a
//     user opens a screen.
//   • gcTime 5min — keep cached pages around so back-navigation is free.
//   • retry 3 with exponential backoff capped at 30s — matches the
//     existing client.ts retry policy. We skip retry on 4xx (permanent)
//     and on auth errors. Network errors (status 0) get full retries.
//   • refetchOnReconnect true — when NetInfo flips back online the
//     query layer re-runs every active query.
//   • refetchOnWindowFocus false — RN doesn't have window focus; we
//     drive focus via AppState in QueryProvider instead.

import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

const MAX_RETRY_DELAY_MS = 30_000;
const RETRY_BASE_DELAY_MS = 1_000;

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        // Retry on transient errors only — 4xx is permanent (validation,
        // 404, 403), so don't burn time re-trying. status 0 is the
        // shape ApiError uses for fetch-level / offline failures.
        retry: (failureCount, error) => {
          if (failureCount >= 3) return false;
          if (error instanceof ApiError) {
            const transient = error.status === 0
              || error.status === 429
              || error.status === 502
              || error.status === 503
              || error.status === 504;
            return transient;
          }
          return failureCount < 3;
        },
        retryDelay: (attemptIndex) =>
          Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attemptIndex), MAX_RETRY_DELAY_MS),
      },
      mutations: {
        // Mutations don't auto-retry — surfacing the error to the UI
        // lets the user decide (their click is the retry). We do not
        // want a silent second POST on a slow network.
        retry: false,
      },
    },
  });
}
