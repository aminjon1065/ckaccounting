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

/** Plain-text receipt for native Share sheet */
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

/** HTML receipt for expo-print (PDF/print) */
export function generateReceiptHtml(sale: Sale): string {
  const itemRows = sale.items
    .map((item) => {
      const name = item.service_name ?? item.product_name ?? item.name ?? "Позиция";
      return `
        <tr>
          <td>${name}</td>
          <td class="num">${fmt(item.price)}</td>
          <td class="num">${item.quantity}</td>
          <td class="num">${fmt(item.total)}</td>
        </tr>`;
    })
    .join("");

  const discountRow =
    sale.discount > 0
      ? `<tr class="summary-row"><td colspan="3">Скидка</td><td class="num">−${fmt(sale.discount)} ${DEFAULT_CURRENCY}</td></tr>`
      : "";

  const debtRow =
    sale.debt > 0
      ? `<tr class="summary-row debt"><td colspan="3">Остаток долга</td><td class="num">${fmt(sale.debt)} ${DEFAULT_CURRENCY}</td></tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Чек #${sale.id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 13px; color: #111; padding: 20px; max-width: 320px; margin: 0 auto; }
  h1 { font-size: 18px; text-align: center; margin-bottom: 4px; }
  .sub { text-align: center; color: #555; font-size: 11px; margin-bottom: 16px; }
  hr { border: none; border-top: 1px dashed #999; margin: 12px 0; }
  .meta { margin-bottom: 12px; font-size: 12px; }
  .meta span { color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: #555; padding-bottom: 6px; border-bottom: 1px solid #ddd; }
  th.num, td.num { text-align: right; }
  td { padding: 5px 0; font-size: 12px; }
  .summary-row td { padding: 4px 0; font-size: 12px; }
  .total-row td { font-weight: bold; font-size: 14px; padding-top: 8px; }
  .paid-row td { color: #15803d; font-size: 12px; }
  .debt { color: #dc2626; }
  .footer { text-align: center; margin-top: 20px; color: #555; font-size: 11px; }
</style>
</head>
<body>
  <h1>${APP_NAME}</h1>
  <p class="sub">Чек #${sale.id} · ${fmtDate(sale.created_at)}</p>
  <hr />
  <div class="meta">
    <div>Клиент: <span>${sale.customer_name || "Без имени"}</span></div>
    <div>Оплата: <span>${PAYMENT_LABELS[sale.payment_type] ?? sale.payment_type}</span></div>
    <div>Тип: <span>${sale.type === "service" ? "Услуга" : "Товар"}</span></div>
  </div>
  <hr />
  <table>
    <thead>
      <tr>
        <th>Наименование</th>
        <th class="num">Цена</th>
        <th class="num">Кол.</th>
        <th class="num">Сумма</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>
  <hr />
  <table>
    <tbody>
      ${discountRow}
      <tr class="total-row">
        <td colspan="3">Итого</td>
        <td class="num">${fmt(sale.total)} ${DEFAULT_CURRENCY}</td>
      </tr>
      <tr class="paid-row">
        <td colspan="3">Оплачено</td>
        <td class="num">${fmt(sale.paid)} ${DEFAULT_CURRENCY}</td>
      </tr>
      ${debtRow}
    </tbody>
  </table>
  ${sale.notes ? `<hr /><p style="font-size:11px;color:#555;">Заметки: ${sale.notes}</p>` : ""}
  <p class="footer">Спасибо за покупку!</p>
</body>
</html>`;
}
