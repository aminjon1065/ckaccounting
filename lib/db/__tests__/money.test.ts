// ─── Money helper regression suite ──────────────────────────────────────────
//
// Money is the most safety-critical math in the app — every sale, debt,
// purchase, expense, and report passes through these four functions.
// A regression here silently corrupts every receipt, dashboard total, and
// reconciliation report at once. This suite locks in:
//
//   • integer-cent rounding semantics for `toKopecks` (no float drift on
//     the wire-format → SQLite boundary).
//   • null/undefined passthrough for both directions (kopecks columns are
//     nullable; a null in must round-trip to 0 out, never NaN).
//   • the `direction` flip for `signedDebtAmount` and the offline-only
//     UI flip for `localDebtTransactionType` (server semantics are unchanged).

import {
  toKopecks,
  fromKopecks,
  signedDebtAmount,
  localDebtTransactionType,
} from "../money";

// ─── toKopecks ──────────────────────────────────────────────────────────────

describe("toKopecks", () => {
  it("converts whole rubles to integer kopecks", () => {
    expect(toKopecks(1)).toBe(100);
    expect(toKopecks(0)).toBe(0);
    expect(toKopecks(150)).toBe(15000);
  });

  it("rounds fractional kopecks to the nearest integer", () => {
    expect(toKopecks(1.234)).toBe(123);  // 123.4 → 123
    expect(toKopecks(1.235)).toBe(124);  // 123.5 → 124 (round half-up via Math.round)
    expect(toKopecks(1.236)).toBe(124);  // 123.6 → 124
  });

  it("avoids float drift on common shop values (the whole point of kopecks)", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754. Kopecks must not leak that.
    expect(toKopecks(0.1 + 0.2)).toBe(30);
    expect(toKopecks(99.99)).toBe(9999);
    expect(toKopecks(1234.56)).toBe(123456);
  });

  it("preserves sign for negative values (used for debt direction)", () => {
    expect(toKopecks(-100)).toBe(-10000);
    expect(toKopecks(-0.5)).toBe(-50);
  });

  it("returns null for null/undefined (nullable kopecks columns)", () => {
    expect(toKopecks(null)).toBeNull();
    expect(toKopecks(undefined)).toBeNull();
  });

  it("does NOT treat 0 as null — 0 rubles is a valid value", () => {
    expect(toKopecks(0)).toBe(0);
    expect(toKopecks(0)).not.toBeNull();
  });
});

// ─── fromKopecks ────────────────────────────────────────────────────────────

describe("fromKopecks", () => {
  it("converts integer kopecks to rubles", () => {
    expect(fromKopecks(100)).toBe(1);
    expect(fromKopecks(15000)).toBe(150);
    expect(fromKopecks(0)).toBe(0);
  });

  it("preserves fractional rubles for sub-ruble values", () => {
    expect(fromKopecks(123)).toBe(1.23);
    expect(fromKopecks(50)).toBe(0.5);
    expect(fromKopecks(1)).toBe(0.01);
  });

  it("returns 0 (not null/NaN) for null/undefined — kopecks columns are nullable", () => {
    expect(fromKopecks(null)).toBe(0);
    expect(fromKopecks(undefined)).toBe(0);
  });

  it("preserves sign", () => {
    expect(fromKopecks(-100)).toBe(-1);
    expect(fromKopecks(-50)).toBe(-0.5);
  });

  it("round-trips with toKopecks for typical money values", () => {
    for (const r of [0, 1, 99.99, 1234.56, -50, 0.5, 12345.67]) {
      const kopecks = toKopecks(r);
      expect(fromKopecks(kopecks)).toBeCloseTo(r, 2);
    }
  });
});

// ─── signedDebtAmount ───────────────────────────────────────────────────────

describe("signedDebtAmount", () => {
  it("preserves a positive amount when direction is receivable", () => {
    expect(signedDebtAmount(100, "receivable")).toBe(100);
    expect(signedDebtAmount(0, "receivable")).toBe(0);
  });

  it("returns the amount as positive for null/undefined direction (legacy default)", () => {
    expect(signedDebtAmount(100, null)).toBe(100);
    expect(signedDebtAmount(100, undefined)).toBe(100);
    expect(signedDebtAmount(100, "")).toBe(100);
  });

  it("flips a payable amount to negative regardless of input sign", () => {
    expect(signedDebtAmount(100, "payable")).toBe(-100);
    expect(signedDebtAmount(-100, "payable")).toBe(-100);
    // Critical: an already-negative amount with payable direction stays negative
    // (the function is canonicalizing, not toggling).
    expect(signedDebtAmount(-50, "payable")).toBe(-50);
  });

  it("normalizes the absolute value before applying direction", () => {
    // A receivable debt stored as -100 in legacy local rows becomes +100.
    expect(signedDebtAmount(-100, "receivable")).toBe(100);
  });
});

// ─── localDebtTransactionType ───────────────────────────────────────────────

describe("localDebtTransactionType", () => {
  it("leaves take/repay unchanged for all directions", () => {
    expect(localDebtTransactionType("take", "receivable")).toBe("take");
    expect(localDebtTransactionType("take", "payable")).toBe("take");
    expect(localDebtTransactionType("repay", "receivable")).toBe("repay");
    expect(localDebtTransactionType("repay", "payable")).toBe("repay");
  });

  it("leaves give unchanged for receivable / null direction", () => {
    expect(localDebtTransactionType("give", "receivable")).toBe("give");
    expect(localDebtTransactionType("give", null)).toBe("give");
    expect(localDebtTransactionType("give", undefined)).toBe("give");
  });

  it("flips give → take only for payable debts (UI-only inversion)", () => {
    expect(localDebtTransactionType("give", "payable")).toBe("take");
  });

  it("preserves the server contract — only the local UI semantics flip", () => {
    // The flip must not be applied twice. Threading the result back through
    // the function is a no-op because "take" is unchanged regardless.
    const once = localDebtTransactionType("give", "payable");
    expect(localDebtTransactionType(once, "payable")).toBe("take");
  });
});
