import { APP_NAME, DEFAULT_CURRENCY } from "@/constants/config";
import { type Sale } from "@/lib/api";

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
};

export function buildReceiptText(sale: Sale): string {
  const lines = [
    APP_NAME,
    "------------------------------",
    `Чек: #${sale.id}`,
    `Дата: ${fmtDate(sale.created_at)}`,
    `Клиент: ${sale.customer_name || "Без имени"}`,
    `Тип: ${sale.type === "service" ? "Услуга" : "Товар"}`,
    `Оплата: ${PAYMENT_LABELS[sale.payment_type] ?? sale.payment_type}`,
    "------------------------------",
  ];

  for (const item of sale.items) {
    const name = item.service_name ?? item.product_name ?? item.name ?? "Позиция";
    lines.push(name);
    lines.push(`  ${fmt(item.quantity)} x ${fmt(item.price)} = ${fmt(item.total)}`);
  }

  lines.push("------------------------------");

  if (sale.discount > 0) {
    lines.push(`Скидка: -${fmt(sale.discount)} ${DEFAULT_CURRENCY}`);
  }

  lines.push(`Итого: ${fmt(sale.total)} ${DEFAULT_CURRENCY}`);
  lines.push(`Оплачено: ${fmt(sale.paid)} ${DEFAULT_CURRENCY}`);

  if (sale.debt > 0) {
    lines.push(`Долг: ${fmt(sale.debt)} ${DEFAULT_CURRENCY}`);
  }

  if (sale.notes) {
    lines.push(`Заметки: ${sale.notes}`);
  }

  lines.push("------------------------------");
  lines.push("Спасибо!");

  return lines.join("\n");
}
