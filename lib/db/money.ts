// ─── Money utilities ───────────────────────────────────────────────────────────
//
// All money values are stored as INTEGER minor units (kopecks) to avoid
// floating-point drift. 1 ruble = 100 kopecks. The API contract over the
// wire keeps the human-readable rubles representation, so conversion
// happens at the SQLite write/read boundary:
//
//   toKopecks(rubles) → integer | null         (writes)
//   fromKopecks(kopecks) → rubles (always 0 on null)  (reads)
//
// Phase 2.4 deleted the legacy REAL columns; these helpers are now the
// single conversion point. A new money column has exactly two consumers:
// the writer that calls toKopecks before INSERT, and the reader that
// calls fromKopecks on SELECT.

import type { DebtTransaction } from "@/lib/api";

export function toKopecks(rubles: number | null | undefined): number | null {
  if (rubles == null) return null;
  return Math.round(rubles * 100);
}

export function fromKopecks(kopecks: number | null | undefined): number {
  if (kopecks == null) return 0;
  return kopecks / 100;
}

/**
 * Apply a sign to a debt amount based on direction. "payable" debts are
 * historically signed-negative in the local DB (legacy from before the
 * `direction` column existed), so consumers that need the canonical
 * signed view call this on read.
 */
export function signedDebtAmount(amount: number, direction: string | null | undefined): number {
  const absolute = Math.abs(amount);
  return direction === "payable" ? -absolute : absolute;
}

/**
 * Normalize a debt-transaction type to the seller-facing semantics for
 * display. For `payable` debts, "give" (we gave money) inverts to "take"
 * because from the seller's UI perspective we received an obligation.
 * Server-side semantics ("give" means hand over money) are unchanged —
 * this only affects local rendering.
 */
export function localDebtTransactionType(
  type: DebtTransaction["type"],
  direction: string | null | undefined
): DebtTransaction["type"] {
  return direction === "payable" && type === "give" ? "take" : type;
}
