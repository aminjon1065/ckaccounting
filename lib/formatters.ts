export function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
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
