import * as React from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Product } from "@/lib/api";

import { PriceMode } from "./types";

export function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const PAYMENT_ICONS: Record<
  string,
  React.ComponentProps<typeof MaterialIcons>["name"]
> = {
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
  markup: "Наценка",
};

export function deriveProductPrice(
  product: Product,
  mode: PriceMode,
  markupPercent: string,
  quantity: number
) {
  if (
    product.bulk_price != null &&
    product.bulk_threshold != null &&
    quantity >= product.bulk_threshold
  ) {
    return product.bulk_price;
  }

  if (mode === "markup") {
    const markupValue = Number(markupPercent);

    if (!Number.isNaN(markupValue)) {
      return product.cost_price * (1 + markupValue / 100);
    }
  }

  return product.sale_price;
}

export function defaultPriceMode(product: Product): PriceMode {
  if (product.pricing_mode === "markup") {
    return "markup";
  }

  if (product.pricing_mode === "manual") {
    return "manual";
  }

  return "fixed";
}
