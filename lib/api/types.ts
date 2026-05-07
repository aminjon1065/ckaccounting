// ─── Shared API types ───────────────────────────────────────────────────────
//
// Truly cross-domain types live here. Domain-specific types (Product,
// Sale, etc.) live next to their endpoint module.

export interface PaginatedMeta {
  current_page: number;
  from: number;
  last_page: number;
  per_page: number;
  to: number;
  total: number;
}

export interface Paginated<T> {
  data: T[];
  links?: { first: string; last: string; prev: string | null; next: string | null };
  meta?: PaginatedMeta;
  /**
   * Present on cursor-paginated endpoints (sales, products, debts, expenses,
   * purchases). Encodes (updated_at, id) of the last row so the next page
   * starts immediately after it. Length-aware paginators omit this.
   */
  next_cursor?: string | null;
  prev_cursor?: string | null;
}
