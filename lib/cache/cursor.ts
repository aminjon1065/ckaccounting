// ─── Composite cursor encoding ────────────────────────────────────────────────
//
// Encodes (updated_at, id) as a base64 JSON token. Combined with server-side
// `ORDER BY updated_at DESC, id DESC`, this produces stable, duplicate-free
// pagination — even when many rows share the same updated_at, the secondary
// id key disambiguates.
//
// `id` accepts both string (UUID-keyed entities: products, sales, debts,
// expenses, purchases) and number (integer-keyed entities: shops). Keeping a
// single helper avoids the five copy-pasted variants this module replaces.

export function encodeCursor(updatedAt: string, id: string | number): string {
  return btoa(JSON.stringify({ updated_at: updatedAt, id }));
}
