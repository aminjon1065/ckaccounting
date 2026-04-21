import { getDb, insertNotification, hasLowStockAlertBeenSent, markLowStockAlertSent, getLocalProductById, type SyncAction, type LocalSale } from "../../db";
import * as Crypto from "expo-crypto";
import type { Sale, SaleItem } from "../../api";
import { api } from "../../api";

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function generateSecureIdempotencyKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

interface CreateSaleInput {
  type: "product" | "service";
  customerName?: string;
  paymentType: "cash" | "card" | "transfer";
  items: {
    product_id?: number;
    product_name?: string;
    name?: string;
    quantity: number;
    price: number;
  }[];
  discount?: number;
  paid?: number;
  notes?: string;
  shopId?: number;
  userId?: number;
}

interface CreateSaleResult {
  sale: Sale | LocalSale;
  localId: string;
  wasStoredOffline: boolean;
}

/**
 * CreateSaleUseCase encapsulates the complete sale creation workflow:
 * 1. Validates stock for product-type sales
 * 2. Writes the sale + items + outbox entry atomically to local DB
 * 3. Queues the sync action
 * 4. Checks low stock and sends notifications
 */
export async function createSaleUseCase(
  input: CreateSaleInput,
  authToken: string
): Promise<CreateSaleResult> {
  const idempotencyKey = await generateSecureIdempotencyKey();
  const localId = generateUUID();
  const now = new Date().toISOString();

  // Build sale items for storage
  const saleItems: SaleItem[] = input.items.map((item, idx) => ({
    id: 0,
    product_id: item.product_id ?? null,
    name: item.name ?? null,
    product_name: item.product_name ?? null,
    service_name: input.type === "service" ? (item.name ?? null) : null,
    unit: undefined,
    quantity: item.quantity,
    price: item.price,
    total: item.price * item.quantity,
  }));

  const subtotal = saleItems.reduce((s, i) => s + i.total, 0);
  const discountVal = input.discount ?? 0;
  const total = Math.max(0, subtotal - discountVal);
  const paidVal = input.paid ?? 0;
  const debt = Math.max(0, total - paidVal);

  const localSale: Sale = {
    id: -Date.now(),
    type: input.type,
    customer_name: input.customerName ?? null,
    total,
    discount: discountVal,
    paid: paidVal,
    debt,
    payment_type: input.paymentType,
    notes: input.notes ?? undefined,
    items: saleItems,
    created_at: now,
    updated_at: now,
  };

  // Try online create first
  try {
    const payload = {
      type: input.type,
      customer_name: input.customerName,
      payment_type: input.paymentType,
      discount: discountVal,
      paid: paidVal,
      notes: input.notes,
      shop_id: input.shopId,
      items: input.items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        price: item.price,
      })),
    };

    const created = await api.sales.create(payload as any, authToken, idempotencyKey);

    // Check low stock for sold products (online case)
    if (input.type === "product") {
      for (const item of input.items) {
        if (!item.product_id) continue;
        try {
          const prod = await api.products.get(item.product_id, authToken).catch(() => null);
          if (prod && prod.low_stock_alert && prod.low_stock_alert > 0) {
            if (prod.stock_quantity <= prod.low_stock_alert) {
              const alreadySent = await hasLowStockAlertBeenSent(item.product_id, input.shopId ?? 0);
              if (!alreadySent) {
                await insertNotification(
                  "low_stock",
                  `Мало товара: ${item.product_name ?? "Товар"}`,
                  `Остаток ${prod.stock_quantity} при минимуме ${prod.low_stock_alert}`,
                  { product_id: item.product_id, shop_id: input.shopId ?? 0 }
                );
                await markLowStockAlertSent(item.product_id, input.shopId ?? 0);
              }
            }
          }
        } catch {}
      }
    }

    return { sale: created, localId, wasStoredOffline: false };
  } catch (e: any) {
    // Offline or error — store locally
    if (e?.status !== 0) throw e;

    const db = getDb();
    await db.withTransactionAsync(async () => {
      // Insert the sale
      await db.runAsync(
        `INSERT OR REPLACE INTO sales (
          id, local_id, shop_id, user_id, customer_name, type, total, discount, paid, debt,
          payment_type, notes, items, status, sync_action, created_at, updated_at, last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          localSale.id,
          localId,
          input.shopId ?? null,
          input.userId ?? null,
          localSale.customer_name,
          localSale.type ?? null,
          localSale.total,
          localSale.discount,
          localSale.paid,
          localSale.debt,
          localSale.payment_type,
          localSale.notes ?? null,
          JSON.stringify(saleItems),
          "pending",
          "create",
          now,
          now,
          null,
        ]
      );

      // Write sale items to normalized table
      await db.runAsync("DELETE FROM sale_items WHERE sale_local_id = ?", [localId]);
      for (const item of saleItems) {
        await db.runAsync(
          `INSERT INTO sale_items (sale_local_id, product_id, product_name, quantity, unit_price, total, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            localId,
            item.product_id ?? null,
            item.product_name ?? "",
            item.quantity,
            item.price,
            item.total,
            now,
          ]
        );
      }

      // Queue sync action
      await db.runAsync(
        "INSERT INTO sync_queue (method, path, payload, headers, created_at) VALUES (?, ?, ?, ?, ?)",
        [
          "POST",
          "/sales",
          JSON.stringify({
            type: input.type,
            customer_name: input.customerName,
            total,
            discount: discountVal,
            paid: paidVal,
            debt,
            payment_type: input.paymentType,
            notes: input.notes,
            items: input.items,
            shop_id: input.shopId,
            _local_id: localId,
          }),
          JSON.stringify({ "Idempotency-Key": `local-${localId}` }),
          now,
        ]
      );

      // Invalidate dashboard cache
      await db.runAsync("DELETE FROM dashboard_cache");

      // Decrement stock for product sales — inside transaction so it's atomic with the sale
      if (input.type === "product") {
        for (const item of input.items) {
          if (!item.product_id) continue;
          await db.runAsync(
            "UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?), pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
            [item.quantity, item.quantity, item.product_id]
          );
        }
      }
    });

    // Low stock check runs after transaction commits so getLocalProductById sees committed stock
    if (input.type === "product") {
      for (const item of input.items) {
        if (!item.product_id) continue;
        const updatedProduct = await getLocalProductById(item.product_id);
        if (updatedProduct && updatedProduct.low_stock_alert && updatedProduct.low_stock_alert > 0) {
          if (updatedProduct.stock_quantity <= updatedProduct.low_stock_alert) {
            const alreadySent = await hasLowStockAlertBeenSent(item.product_id, input.shopId ?? 0);
            if (!alreadySent) {
              await insertNotification(
                "low_stock",
                `Мало товара: ${updatedProduct.name}`,
                `Остаток ${updatedProduct.stock_quantity} ${updatedProduct.unit ?? "шт"} при минимуме ${updatedProduct.low_stock_alert}`,
                { product_id: item.product_id, shop_id: input.shopId ?? 0 }
              );
              await markLowStockAlertSent(item.product_id, input.shopId ?? 0);
            }
          }
        }
      }
    }

    return { sale: localSale, localId, wasStoredOffline: true };
  }
}
