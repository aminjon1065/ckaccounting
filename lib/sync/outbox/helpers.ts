// ─── Outbox helpers ─────────────────────────────────────────────────────────
//
// Pure utilities shared across the request builder and the response
// handlers. Keep this file dependency-free (no DB, no fetch, no observability)
// so it can be unit-tested in isolation.

/** Return quantity as a safe positive finite number, or null if invalid. */
export function safeQty(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Map the request path back to the SQLite table the action touched. Used
 * by the response handler to apply table-specific writeback (status,
 * sync_action, version, last_synced_at) without baking those rules into
 * every endpoint.
 */
export function entityTableForPath(path: string): string | null {
  if (/\/debts\/[^/]+\/transactions/.test(path)) return "debt_transactions";
  if (path.includes("/sales")) return "sales";
  if (path.includes("/products")) return "products";
  if (path.includes("/expenses")) return "expenses";
  if (path.includes("/purchases")) return "purchases";
  if (path.includes("/shops")) return "shops";
  if (path.includes("/debts")) return "debts";
  return null;
}

/**
 * Drop client-only metadata keys (prefixed with `_`) from a payload before
 * shipping to the server. Currently used to strip `_local_id` from shop
 * POSTs — that field is the local handle for ID remapping and would 422
 * the server's validator.
 */
export function stripClientMeta(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !key.startsWith("_"))
  );
}

/**
 * Pull the entity object out of a server response, handling both the
 * Laravel envelope shape (`{success, data: {...entity}}`) and the
 * bare-entity shape that some legacy endpoints still return. Returns
 * `null` when neither shape matches so callers can fall back to no-version
 * writeback rather than crash on malformed bodies.
 */
export function extractServerEntity(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  if ("data" in obj && obj.data && typeof obj.data === "object") {
    return obj.data as Record<string, unknown>;
  }
  return obj;
}
