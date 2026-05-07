// ─── Notifications & low-stock alerts ─────────────────────────────────────────
//
// Two related concerns kept together because they share the underlying
// in-app notification table and the low-stock check is the only producer
// that writes to it from the sync layer:
//
//   • `notifications` — generic in-app inbox (used by the bell icon).
//   • `low_stock_alerts_sent` — dedupe table so we don't spam the user
//     with the same low-stock notification on every sync cycle.
//
// `checkAndNotifyLowStock` is called by SyncOrchestrator after a
// successful product pull. It walks rows where current stock fell at or
// below the per-product `low_stock_alert` threshold, deduplicates against
// `low_stock_alerts_sent`, writes a notification row, and fires a system
// notification through expo-notifications (best-effort — if that fails,
// the in-app inbox still got the entry).

import { getDb } from "./schema";

export interface LocalNotification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  read: boolean;
  created_at: string;
}

export async function insertNotification(
  type: string,
  title: string,
  body: string | null = null,
  data: Record<string, unknown> | null = null
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT INTO notifications (type, title, body, data, read, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [type, title, body, data ? JSON.stringify(data) : null, new Date().toISOString()]
  );
}

/** Raw shape returned by SQLite — `read` comes back as 0/1, not a boolean. */
interface NotificationRow {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  read: number;
  created_at: string;
}

export async function getUnreadNotifications(): Promise<LocalNotification[]> {
  const db = getDb();
  const rows = await db.getAllAsync<NotificationRow>(
    "SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT 50"
  );
  return rows.map((row) => ({ ...row, read: !!row.read }));
}

export async function markNotificationsRead(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  await db.runAsync(`UPDATE notifications SET read = 1 WHERE id IN (${placeholders})`, ids);
}

// ─── Low Stock ───────────────────────────────────────────────────────────────

export async function hasLowStockAlertBeenSent(productId: string, shopId: number): Promise<boolean> {
  const db = getDb();
  const row = await db.getFirstAsync<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM low_stock_alerts_sent WHERE product_id = ? AND shop_id = ?",
    [productId, shopId]
  );
  return (row?.cnt ?? 0) > 0;
}

export async function markLowStockAlertSent(productId: string, shopId: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR IGNORE INTO low_stock_alerts_sent (product_id, shop_id, sent_at) VALUES (?, ?, ?)",
    [productId, shopId, new Date().toISOString()]
  );
}

interface LowStockProductRow {
  id: string;
  name: string;
  code: string | null;
  unit: string | null;
  stock_quantity: number;
  low_stock_alert: number | null;
}

export async function checkAndNotifyLowStock(shopId: number): Promise<void> {
  const db = getDb();
  const rows = await db.getAllAsync<LowStockProductRow>(
    `SELECT id, name, code, unit, stock_quantity, low_stock_alert
     FROM products
     WHERE shop_id = ?
       AND low_stock_alert IS NOT NULL
       AND low_stock_alert > 0
       AND stock_quantity <= low_stock_alert`,
    [shopId]
  );

  for (const p of rows) {
    const alreadySent = await hasLowStockAlertBeenSent(p.id, shopId);
    if (alreadySent) continue;

    const title = `Мало товара: ${p.name}`;
    const body = `Остаток ${p.stock_quantity} ${p.unit ?? "шт"} при минимуме ${p.low_stock_alert}`;
    await insertNotification("low_stock", title, body, { product_id: p.id, shop_id: shopId });
    await markLowStockAlertSent(p.id, shopId);

    // Best-effort: surface a system notification too. If expo-notifications
    // isn't initialised (e.g. test env), the in-app row already landed.
    try {
      const { showLocalNotification } = await import("@/lib/notifications");
      await showLocalNotification(title, body, { product_id: p.id, shop_id: shopId });
    } catch {
      // intentionally silent — see comment above
    }
  }
}
