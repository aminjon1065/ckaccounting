import * as React from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { PriceMode } from "./types";

export function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { month: "short", day: "numeric", year: "numeric" });
}

export const PAYMENT_ICONS: Record<string, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  cash: "payments",
  card: "credit-card",
  transfer: "swap-horiz",
};

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Нал.",
  card: "Карта",
  transfer: "Перевод",
};

export const PRICE_MODE_LABELS: Record<PriceMode, string> = {
  fixed: "Фикс.",
  manual: "Вручную",
  auto: "Наценка",
};
