// ─── HTTP client ────────────────────────────────────────────────────────────
//
// Single fetch wrapper used by every endpoint module. Owns:
//   • online-state probe (NetInfo cache + fallback)
//   • bearer-token auth header injection
//   • Laravel envelope auto-unwrap ({ success, data, meta, links } → T)
//   • exponential-backoff retries on transient statuses (0/429/502/503/504)
//   • single-flight token refresh on 401 via TokenRefreshBridge
//   • shop-suspension dispatch on 403
//   • last server_time capture for delta-sync high-water marks
//
// Domain endpoint files (`./products`, `./sales`, …) compose this `request`
// function — they don't talk to fetch directly.

import NetInfo from "@react-native-community/netinfo";
import { API_URL, TIMEOUTS } from "@/constants/config";
import { triggerSuspension } from "@/store/suspension";
import { attemptTokenRefresh } from "./tokenRefresh";
import { useNetworkStore } from "@/lib/network/NetworkProvider";

const BASE_URL = API_URL;

// ─── Error ──────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiError";
  }

  /**
   * Produce a user-facing string describing every field-level error.
   * Falls back to `message` when the server response carries no `errors`
   * map (typical for non-validation 4xx). When validation errors are
   * present, returns one line per field, e.g.:
   *   `shop_id: The selected shop id is invalid.`
   *   `items.0.product_id: The selected items.0.product id is invalid.`
   *
   * Use this in form-level error display instead of `e.message` alone —
   * the bare message often surfaces only the first field, leaving the
   * user guessing which other fields are wrong.
   */
  describeErrors(): string {
    if (!this.errors || Object.keys(this.errors).length === 0) {
      return this.message;
    }
    return Object.entries(this.errors)
      .map(([field, messages]) => `${field}: ${messages.join("; ")}`)
      .join("\n");
  }
}

// ─── Online probe ───────────────────────────────────────────────────────────
//
// Reads from the same Zustand store the NetworkProvider listener writes to.
// One source of truth — no duplicate NetInfo subscriptions, no listener
// running in this module before React mounts.
//
// During the brief boot window before NetworkProvider's `useEffect` fires,
// the store defaults to `isOnline: true` (optimistic). If the device is
// actually offline we still degrade gracefully — the fetch below will fail
// fast with a network error and the retry layer handles it.

async function isOnline(): Promise<boolean> {
  // Fast path: the listener-driven store value.
  if (useNetworkStore.getState().isOnline) return true;

  // Listener says we're offline. Double-check via a bounded probe to catch
  // the case where NetInfo's `isInternetReachable` is stuck at `null` on
  // Android — those devices would otherwise be perma-offline in our eyes.
  try {
    const state = await Promise.race([
      NetInfo.fetch(),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), TIMEOUTS.reachability)
      ),
    ]);
    if (!state) return true; // probe timed out — let fetch decide
    return !!state.isConnected && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

// ─── Retry helper ───────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;

function isRetryableStatus(status: number): boolean {
  return status === 0       // network error / no connection
    || status === 429       // rate limited
    || status === 502       // bad gateway
    || status === 503       // service unavailable
    || status === 504;      // gateway timeout
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  tokenRef?: { current: string | undefined }
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0 && __DEV__) console.log(`[api] retry attempt #${attempt}`);
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && attempt < retries) {
        // On 401: attempt token refresh once, then retry with the new token.
        if (err.status === 401 && tokenRef?.current && attempt === 0) {
          const newToken = await attemptTokenRefresh(tokenRef!.current);
          if (newToken) {
            // Update the shared token ref; fn() re-reads options.token each time.
            tokenRef.current = newToken;
            try {
              return await fn();
            } catch (retryErr) {
              if (retryErr instanceof ApiError && isRetryableStatus(retryErr.status)) {
                await new Promise((r) => setTimeout(r, Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt), 30_000)));
                continue;
              }
              throw retryErr;
            }
          }
          // Refresh failed — fall through to normal error handling.
        }
        // 4xx errors are permanent (validation, auth, etc.) — don't retry.
        if (!isRetryableStatus(err.status)) {
          throw err;
        }
        // If the OS reports we're offline now, don't waste backoff time —
        // the next attempt would just hit the same offline guard and fail.
        if (err.status === 0 && !(await isOnline())) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt), 30_000)));
        continue;
      }
      throw err;
    }
  }
  throw new ApiError("Retry exhausted", 0);
}

// ─── Server time tracking ───────────────────────────────────────────────────

let lastServerTime: string | null = null;

export function getLastServerTime(): string | null {
  return lastServerTime;
}

// ─── Core fetch ─────────────────────────────────────────────────────────────

export async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  // Use a holder object so withRetry can update the token after refresh.
  // The closure (fn) reads options.token each time, which will pick up the
  // updated holder.current after a token refresh.
  const tokenHolder = { current: options.token ?? undefined };

  return withRetry(async () => {
    const { token: _token, headers: extraHeaders, ...rest } = options;

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(extraHeaders as Record<string, string>),
    };

    // Don't set Content-Type for FormData — React Native sets it automatically
    // with the correct multipart boundary. For all other bodies use JSON.
    if (!(rest.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    // Read from holder so retries after token refresh pick up the new token.
    if (tokenHolder.current) headers["Authorization"] = `Bearer ${tokenHolder.current}`;

    // Fail fast when the OS already knows we're offline — avoids burning
    // the full request timeout (and retry backoff) on a guaranteed failure.
    if (!(await isOnline())) {
      throw new ApiError("Нет соединения с сервером. Проверьте интернет.", 0);
    }

    const controller = new AbortController();
    // Photo uploads (FormData) get a longer timeout than regular JSON requests.
    const isUpload = rest.body instanceof FormData;
    const timeout = isUpload ? TIMEOUTS.upload : TIMEOUTS.request;
    const timer = setTimeout(() => controller.abort(), timeout);

    let res: Response;
    const t0 = __DEV__ ? Date.now() : 0;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        ...rest,
        headers,
        signal: controller.signal,
      });
      if (__DEV__) console.log(`[api] ${rest.method ?? "GET"} ${path} → ${res.status} in ${Date.now() - t0}ms`);
    } catch (err) {
      if (__DEV__) console.log(`[api] ${rest.method ?? "GET"} ${path} FAILED in ${Date.now() - t0}ms: ${(err as Error)?.name}/${(err as Error)?.message}`);
      if (err instanceof Error && err.name === "AbortError") {
        throw new ApiError("Превышено время ожидания. Проверьте соединение.", 0);
      }
      throw new ApiError("Нет соединения с сервером. Проверьте интернет.", 0);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 403) {
        triggerSuspension();
      }
      // 401 is NOT signaled to the React tree here. The retry layer above
      // hands it to TokenRefreshBridge, which is the single source of truth
      // for "this token is dead": it owns single-flight refresh + circuit
      // breaker, and only fires triggerTokenExpiry() if refresh is genuinely
      // unrecoverable. Triggering expiry here would race a concurrent
      // refresh and bounce the user to /login mid-recovery.
      throw new ApiError(
        body.message ?? `Request failed with status ${res.status}`,
        res.status,
        body.errors
      );
    }

    if (res.status === 204) return undefined as T;

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiError("Некорректный ответ сервера.", res.status);
    }

    // Capture server_time for sync high-water mark persistence.
    if (json !== null && typeof json === "object" && "server_time" in json) {
      const serverTime = (json as Record<string, unknown>).server_time;
      if (typeof serverTime === "string") {
        lastServerTime = serverTime;
      }
    }

    // Auto-unwrap Laravel envelope: { success, message, data, [meta, links] }.
    if (json !== null && typeof json === "object" && "success" in json) {
      const envelope = json as Record<string, unknown>;
      // Paginated response: meta & links live at the TOP LEVEL alongside data,
      // e.g. { success, message, data: [...], meta: { current_page, ... }, links: {...} }.
      if ("meta" in envelope && envelope.meta != null) {
        return {
          data: envelope.data ?? [],
          meta: envelope.meta,
          links: envelope.links ?? {},
        } as T;
      }

      // Single-object response: { success, message, data: { ... } }.
      if ("data" in envelope && envelope.data !== undefined && envelope.data !== null) {
        return envelope.data as T;
      }
    }

    return json as T;
  }, MAX_RETRIES, tokenHolder);
}

// ─── Query builder ──────────────────────────────────────────────────────────

export function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}
