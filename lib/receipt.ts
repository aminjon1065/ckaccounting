import { APP_NAME, DEFAULT_CURRENCY } from "@/constants/config";
import { type Sale } from "@/lib/api";
import { fmt } from "@/lib/formatters";

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
export function buildReceiptText(sale: Sale, shopName?: string | null): string {
  const returnedTotal = sale.returned_total ?? 0;
  const isFullyReturned = !!sale.is_fully_returned;
  const hasReturn = returnedTotal > 0;

  const header = [APP_NAME];
  if (shopName && shopName.trim() !== "") {
    header.push(shopName.trim());
  }

  const lines = [
    ...header,
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
    const returnedQty = item.returned_quantity ?? 0;
    lines.push(name);
    lines.push(`  ${fmt(item.quantity)} x ${fmt(item.price)} = ${fmt(item.total)}`);
    if (returnedQty > 0) {
      lines.push(`  Возвращено: ${fmt(returnedQty)} из ${fmt(item.quantity)}`);
    }
  }

  lines.push("------------------------------");

  if (sale.discount > 0) {
    lines.push(`Скидка: -${fmt(sale.discount)} ${DEFAULT_CURRENCY}`);
  }

  lines.push(`Итого: ${fmt(sale.total)} ${DEFAULT_CURRENCY}`);
  // Money side: show "Оплачено (сейчас)" when there was a refund so the
  // reader can match the figure against the separate "Возвращено" line.
  lines.push(`${hasReturn ? "Оплачено (сейчас)" : "Оплачено"}: ${fmt(sale.paid)} ${DEFAULT_CURRENCY}`);

  if (hasReturn) {
    lines.push(
      `${isFullyReturned ? "Возвращено полностью" : "Возвращено"}: -${fmt(returnedTotal)} ${DEFAULT_CURRENCY}`,
    );
  }

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
export function generateReceiptHtml(sale: Sale, shopName?: string | null): string {
  const returnedTotal = sale.returned_total ?? 0;
  const isFullyReturned = !!sale.is_fully_returned;
  const hasReturn = returnedTotal > 0;

  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const itemRows = sale.items
    .map((item) => {
      const name = escape(item.service_name ?? item.product_name ?? item.name ?? "Позиция");
      const returnedQty = item.returned_quantity ?? 0;
      const fullyReturned = returnedQty >= item.quantity;
      const nameCell = fullyReturned
        ? `<span class="returned">${name}</span>`
        : name;
      const totalCell = fullyReturned
        ? `<span class="returned">${fmt(item.total)}</span>`
        : fmt(item.total);
      const refundNote =
        returnedQty > 0
          ? `<div class="refund-note">Возвращено: ${fmt(returnedQty)} из ${fmt(item.quantity)}</div>`
          : "";
      return `
        <tr>
          <td>${nameCell}${refundNote}</td>
          <td class="num">${fmt(item.price)}</td>
          <td class="num">${fmt(item.quantity)}</td>
          <td class="num">${totalCell}</td>
        </tr>`;
    })
    .join("");

  const discountRow =
    sale.discount > 0
      ? `<tr class="summary-row"><td colspan="3">Скидка</td><td class="num">−${fmt(sale.discount)} ${DEFAULT_CURRENCY}</td></tr>`
      : "";

  // Refund line: show separately so the reader can reconcile "Оплачено
  // (сейчас)" against the original sale amount.
  const returnedRow = hasReturn
    ? `<tr class="summary-row refund"><td colspan="3">${
        isFullyReturned ? "Возвращено полностью" : "Возвращено"
      }</td><td class="num">−${fmt(returnedTotal)} ${DEFAULT_CURRENCY}</td></tr>`
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
  .shop { text-align: center; color: #111; font-size: 13px; font-weight: 600; margin-bottom: 2px; }
  .sub { text-align: center; color: #555; font-size: 11px; margin-bottom: 16px; }
  hr { border: none; border-top: 1px dashed #999; margin: 12px 0; }
  .meta { margin-bottom: 12px; font-size: 12px; }
  .meta span { color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: #555; padding-bottom: 6px; border-bottom: 1px solid #ddd; }
  th.num, td.num { text-align: right; }
  td { padding: 5px 0; font-size: 12px; vertical-align: top; }
  .summary-row td { padding: 4px 0; font-size: 12px; }
  .total-row td { font-weight: bold; font-size: 14px; padding-top: 8px; }
  .paid-row td { color: #15803d; font-size: 12px; }
  .debt { color: #dc2626; }
  .refund td { color: #b45309; }
  .returned { color: #94a3b8; text-decoration: line-through; }
  .refund-note { color: #b45309; font-size: 10px; margin-top: 2px; }
  .footer { text-align: center; margin-top: 20px; color: #555; font-size: 11px; }
  .return-banner { background: #fef3c7; color: #92400e; padding: 6px 8px; border-radius: 4px; text-align: center; font-size: 11px; margin: 8px 0; }
</style>
</head>
<body>
  <h1>${APP_NAME}</h1>
  ${shopName && shopName.trim() !== "" ? `<p class="shop">${escape(shopName.trim())}</p>` : ""}
  <p class="sub">Чек #${sale.id} · ${fmtDate(sale.created_at)}</p>
  ${isFullyReturned ? `<p class="return-banner">Полный возврат: −${fmt(returnedTotal)} ${DEFAULT_CURRENCY}</p>` : ""}
  <hr />
  <div class="meta">
    <div>Клиент: <span>${escape(sale.customer_name || "Без имени")}</span></div>
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
        <td colspan="3">${hasReturn ? "Оплачено (сейчас)" : "Оплачено"}</td>
        <td class="num">${fmt(sale.paid)} ${DEFAULT_CURRENCY}</td>
      </tr>
      ${returnedRow}
      ${debtRow}
    </tbody>
  </table>
  ${sale.notes ? `<hr /><p style="font-size:11px;color:#555;">Заметки: ${escape(sale.notes)}</p>` : ""}
  <p class="footer">Спасибо за покупку!</p>
</body>
</html>`;
}
