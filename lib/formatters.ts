/**
 * Parse a user-typed decimal string. Normalises Russian-style comma to dot
 * before `parseFloat` — without this, `parseFloat("3,5")` returns 3 and the
 * fractional part is silently dropped (entered "3,5", saved as 3).
 *
 * Returns NaN for unparseable input. Caller decides the fallback (0, error
 * toast, etc.) — we don't want a silent zero hiding a typo upstream.
 */
export function parseDecimal(input: string | null | undefined): number {
  if (input == null) return NaN;
  const normalised = String(input).replace(/,/g, ".").trim();
  if (normalised === "") return NaN;
  return parseFloat(normalised);
}

/**
 * Format a number for display.
 *
 * Integer part uses a thin-space thousand separator; decimal part is shown
 * only when non-zero, up to `decimals` places (default 2), with trailing
 * zeros trimmed. Russian locale: decimal separator is comma.
 *
 * Why: this app handles money. Values like 3.5, 10.5, 999.99 must render as
 * "3,5", "10,5", "999,99" — never as "4", "11", "1 000". Rounding here used
 * to silently mutate displayed prices and produce drift when users summed
 * displayed values mentally vs. the server's authoritative kopecks.
 *
 * The math itself is rounded to `decimals` places to suppress JS float drift
 * (e.g. `0.1 + 0.2` → 0.30000000000000004 → "0,3"), but never beyond that —
 * the user's typed "3.5" stays "3,5".
 */
export function fmt(n: number, opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? 2;
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const factor = 10 ** decimals;
  const rounded = Math.round(abs * factor) / factor;
  const fixed = rounded.toFixed(decimals);
  const [intPart, fracPart = ""] = fixed.split(".");
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const trimmed = fracPart.replace(/0+$/, "");
  return trimmed ? `${sign}${intGrouped},${trimmed}` : `${sign}${intGrouped}`;
}

export function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export function fmtChange(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDateISO(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { month: "short", day: "numeric" });
}

export function getGreeting(name?: string | null): string {
  const h = new Date().getHours();
  const base = h < 12 ? "Доброе утро" : h < 17 ? "Добрый день" : "Добрый вечер";
  return name ? `${base}, ${name.split(" ")[0]}` : base;
}

export function formatDate(): string {
  return new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
