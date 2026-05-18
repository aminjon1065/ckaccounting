import * as React from "react";
import * as Crypto from "expo-crypto";
import {
  Modal,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Button, Input, Text } from "@/components/ui";
import {
  api,
  ApiError,
  type Product,
  type Sale,
  type UpdateSalePayload,
} from "@/lib/api";
import { useToast } from "@/store/toast";
import { useAuth } from "@/store/auth";
import { useUpdateSale } from "@/lib/queries/sales";
import { reportError } from "@/lib/observability/reporter";
import { parseDecimal } from "@/lib/formatters";

import { CartRow } from "./CartRow";
import { ProductPicker } from "./ProductPicker";
import { ServiceItemRow } from "./ServiceItemRow";
import {
  deriveProductPrice,
  defaultPriceMode,
  fmt,
  PAYMENT_ICONS,
  PAYMENT_LABELS,
} from "./helpers";
import type { CartItem, PriceMode, ServiceLineItem } from "./types";

type PaymentType = "cash" | "card" | "transfer";

interface EditSaleModalProps {
  visible: boolean;
  sale: Sale;
  token: string;
  onClose: () => void;
  onSuccess: (updated: Sale) => void;
  /** Server reported the sale no longer exists — caller should evict it locally. */
  onMissing?: () => void;
}

// ─── Cart seeding ───────────────────────────────────────────────────────────
//
// The detail endpoint returns SaleItem rows but doesn't include the full
// Product shape (stock_quantity, sale_price, pricing_mode). To keep the
// existing CartRow component working we synthesise stub Products for
// pre-existing lines using whatever we have from the sale; once the user
// opens the product picker, real Products from /products replace the stubs
// when the user adds new lines.

function makeStubProduct(item: Sale["items"][number]): Product {
  return {
    id: item.product_id as string,
    name: item.product_name ?? "Товар",
    // Stock unknown for the stub — set to a large number so the +/− buttons
    // don't refuse to grow the line. Real stock check still runs server-side.
    stock_quantity: Number.MAX_SAFE_INTEGER,
    cost_price: 0,
    sale_price: item.price,
    unit: item.unit ?? null,
    pricing_mode: "manual",
  } as Product;
}

function seedCart(sale: Sale): CartItem[] {
  return sale.items
    .filter((item) => item.product_id != null)
    .map((item) => {
      const product = makeStubProduct(item);
      return {
        product,
        quantity: item.quantity,
        quantityInput: String(item.quantity),
        price: item.price,
        priceMode: "manual" as PriceMode,
        markupPercent: "",
      };
    });
}

function seedServices(sale: Sale): ServiceLineItem[] {
  return sale.items
    .filter((item) => item.product_id == null)
    .map((item, index) => ({
      id: `existing-${index}`,
      name: item.name ?? item.service_name ?? "",
      unit: item.unit ?? "шт",
      quantity: item.quantity,
      quantityInput: String(item.quantity),
      price: String(item.price),
    }));
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EditSaleModal({
  visible,
  sale,
  token,
  onClose,
  onSuccess,
  onMissing,
}: EditSaleModalProps) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const updateMutation = useUpdateSale(token);
  const submitting = updateMutation.isPending;
  const canEditPrice = user?.role !== "seller";

  // Lines that the sale already had a return against can't safely be
  // re-edited — replacing items would orphan the SaleReturnItem rows
  // that reference them. Force metadata-only editing in that case.
  const hasReturns = (sale.returned_total ?? 0) > 0;

  // ── Form state ──
  const [customerName, setCustomerName] = React.useState(sale.customer_name ?? "");
  const [paymentType, setPaymentType] = React.useState<PaymentType>(sale.payment_type);
  const [discount, setDiscount] = React.useState(
    sale.discount > 0 ? String(sale.discount) : "",
  );
  const [paid, setPaid] = React.useState(String(sale.paid ?? 0));
  const [notes, setNotes] = React.useState(sale.notes ?? "");

  const [cart, setCart] = React.useState<CartItem[]>(() => seedCart(sale));
  const [serviceItems, setServiceItems] = React.useState<ServiceLineItem[]>(() =>
    seedServices(sale),
  );
  const serviceIdRef = React.useRef(seedServices(sale).length);

  // Track whether the user has touched any line — only then do we send
  // `items` to the server. Pristine = metadata-only patch, no stock churn.
  const itemsDirtyRef = React.useRef(false);
  const markItemsDirty = React.useCallback(() => {
    itemsDirtyRef.current = true;
  }, []);

  const [products, setProducts] = React.useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = React.useState(false);
  const [pickerVisible, setPickerVisible] = React.useState(false);
  const [error, setError] = React.useState("");

  // Re-seed when the modal reopens with a different sale.
  React.useEffect(() => {
    if (!visible) return;
    setCustomerName(sale.customer_name ?? "");
    setPaymentType(sale.payment_type);
    setDiscount(sale.discount > 0 ? String(sale.discount) : "");
    setPaid(String(sale.paid ?? 0));
    setNotes(sale.notes ?? "");
    setCart(seedCart(sale));
    const seededServices = seedServices(sale);
    setServiceItems(seededServices);
    serviceIdRef.current = seededServices.length;
    itemsDirtyRef.current = false;
    setError("");
  }, [visible, sale]);

  // Lazy-load the catalog the first time the picker opens. Scoped to the
  // sale's shop so we don't pull cross-shop products that would 404 on
  // submit. See ProductRepository::queryForUser — multi-shop owners can
  // narrow via shop_id.
  React.useEffect(() => {
    if (!visible || !pickerVisible || products.length > 0) return;
    setProductsLoading(true);
    const shopId = sale.shop_id ?? undefined;
    api.products
      .list(token, { limit: 200, shop_id: shopId ?? undefined })
      .then((res) => setProducts(res.data))
      .catch((e) => reportError(e, { tag: "edit-sale-products-load" }))
      .finally(() => setProductsLoading(false));
  }, [visible, pickerVisible, products.length, sale.shop_id, token]);

  // ── Cart helpers (mirror CreateSaleModal patterns) ──

  const addToCart = React.useCallback(
    (p: Product) => {
      markItemsDirty();
      setCart((prev) => {
        const existing = prev.find((c) => c.product.id === p.id);
        if (existing) {
          const newQty = existing.quantity + 1;
          return prev.map((c) => {
            if (c.product.id !== p.id) return c;
            return {
              ...c,
              // The fresh Product from the picker replaces any earlier
              // stub so price-mode / cost calculations get the real data.
              product: p,
              quantity: newQty,
              quantityInput: String(newQty),
              price:
                c.priceMode === "manual"
                  ? c.price
                  : deriveProductPrice(p, c.priceMode, c.markupPercent, newQty),
            };
          });
        }
        const priceMode = defaultPriceMode(p);
        const markupPercent =
          priceMode === "markup" && p.markup_percent != null
            ? String(p.markup_percent)
            : "";
        return [
          ...prev,
          {
            product: p,
            quantity: 1,
            quantityInput: "1",
            price: deriveProductPrice(p, priceMode, markupPercent, 1),
            priceMode,
            markupPercent,
          },
        ];
      });
    },
    [markItemsDirty],
  );

  const removeCartItem = React.useCallback(
    (productId: string) => {
      markItemsDirty();
      setCart((prev) => prev.filter((c) => c.product.id !== productId));
    },
    [markItemsDirty],
  );

  const adjustCartQuantity = React.useCallback(
    (productId: string, delta: number) => {
      markItemsDirty();
      setCart((prev) => {
        const target = prev.find((c) => c.product.id === productId);
        if (!target) return prev;
        const nextQty = target.quantity + delta;
        return prev
          .map((c) => {
            if (c.product.id !== productId) return c;
            const quantity = Math.max(0, nextQty);
            return {
              ...c,
              quantity,
              quantityInput: String(quantity),
              price:
                c.priceMode === "manual"
                  ? c.price
                  : deriveProductPrice(
                      c.product,
                      c.priceMode,
                      c.markupPercent,
                      Math.max(quantity, 1),
                    ),
            };
          })
          .filter((c) => c.quantity > 0);
      });
    },
    [markItemsDirty],
  );

  const updateCartQuantity = React.useCallback(
    (productId: string, rawQuantity: string) => {
      markItemsDirty();
      const normalized = rawQuantity.replace(",", ".").trim();
      setCart((prev) =>
        prev.map((c) => {
          if (c.product.id !== productId) return c;
          if (!normalized) return { ...c, quantityInput: "" };
          const parsed = Number(normalized);
          if (Number.isNaN(parsed) || parsed <= 0) {
            return { ...c, quantityInput: rawQuantity };
          }
          return {
            ...c,
            quantity: parsed,
            quantityInput: rawQuantity,
            price:
              c.priceMode === "manual"
                ? c.price
                : deriveProductPrice(c.product, c.priceMode, c.markupPercent, parsed),
          };
        }),
      );
    },
    [markItemsDirty],
  );

  const finalizeCartQuantity = React.useCallback((productId: string) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.id !== productId) return c;
        const normalized = (c.quantityInput ?? "").replace(",", ".").trim();
        if (!normalized) return { ...c, quantityInput: String(c.quantity) };
        const parsed = Number(normalized);
        if (Number.isNaN(parsed) || parsed <= 0) {
          return { ...c, quantityInput: String(c.quantity) };
        }
        return { ...c, quantity: parsed, quantityInput: String(parsed) };
      }),
    );
  }, []);

  const updatePrice = React.useCallback(
    (productId: string, price: string) => {
      markItemsDirty();
      setCart((prev) =>
        prev.map((c) =>
          c.product.id === productId
            ? { ...c, price: isNaN(Number(price)) ? c.price : Number(price) }
            : c,
        ),
      );
    },
    [markItemsDirty],
  );

  const updatePriceMode = React.useCallback(
    (productId: string, mode: PriceMode) => {
      markItemsDirty();
      setCart((prev) =>
        prev.map((c) => {
          if (c.product.id !== productId) return c;
          const nextMarkupPercent =
            mode === "markup"
              ? c.markupPercent ||
                (c.product.markup_percent != null
                  ? String(c.product.markup_percent)
                  : "")
              : c.markupPercent;
          const price =
            mode === "manual"
              ? c.price
              : deriveProductPrice(c.product, mode, nextMarkupPercent, c.quantity);
          return { ...c, priceMode: mode, markupPercent: nextMarkupPercent, price };
        }),
      );
    },
    [markItemsDirty],
  );

  const updateMarkup = React.useCallback(
    (productId: string, markup: string) => {
      markItemsDirty();
      setCart((prev) =>
        prev.map((c) => {
          if (c.product.id !== productId) return c;
          const price =
            markup && !isNaN(Number(markup))
              ? deriveProductPrice(c.product, "markup", markup, c.quantity)
              : c.price;
          return { ...c, markupPercent: markup, price };
        }),
      );
    },
    [markItemsDirty],
  );

  // ── Service helpers ──

  const addServiceItem = React.useCallback(() => {
    markItemsDirty();
    const id = `new-${serviceIdRef.current++}`;
    setServiceItems((prev) => [
      ...prev,
      { id, name: "", unit: "шт", quantity: 1, quantityInput: "1", price: "" },
    ]);
  }, [markItemsDirty]);

  const updateServiceItem = React.useCallback(
    (id: string, patch: Partial<ServiceLineItem>) => {
      markItemsDirty();
      setServiceItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [markItemsDirty],
  );

  const removeServiceItem = React.useCallback(
    (id: string) => {
      markItemsDirty();
      setServiceItems((prev) => prev.filter((item) => item.id !== id));
    },
    [markItemsDirty],
  );

  const updateServiceQuantity = React.useCallback(
    (id: string, rawQuantity: string) => {
      markItemsDirty();
      const normalized = rawQuantity.replace(",", ".").trim();
      setServiceItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          if (!normalized) return { ...item, quantityInput: "" };
          const parsed = Number(normalized);
          if (Number.isNaN(parsed) || parsed <= 0) {
            return { ...item, quantityInput: rawQuantity };
          }
          return { ...item, quantity: parsed, quantityInput: rawQuantity };
        }),
      );
    },
    [markItemsDirty],
  );

  const finalizeServiceQuantity = React.useCallback((id: string) => {
    setServiceItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const normalized = (item.quantityInput ?? "").replace(",", ".").trim();
        if (!normalized) return { ...item, quantityInput: String(item.quantity) };
        const parsed = Number(normalized);
        if (Number.isNaN(parsed) || parsed <= 0) {
          return { ...item, quantityInput: String(item.quantity) };
        }
        return { ...item, quantity: parsed, quantityInput: String(parsed) };
      }),
    );
  }, []);

  // ── Calculations ──

  const subtotal =
    cart.reduce((s, c) => s + c.price * c.quantity, 0) +
    serviceItems.reduce((s, i) => s + (parseDecimal(i.price) || 0) * i.quantity, 0);
  const discountVal = parseDecimal(discount) || 0;
  const total = Math.max(0, subtotal - discountVal);
  const paidVal = parseDecimal(paid) || 0;
  const unpaid = Math.max(0, total - paidVal);
  const overpaid = Math.max(0, paidVal - total);

  // ── Submit ──

  const handleSave = async () => {
    setError("");

    const itemsChanged = itemsDirtyRef.current;

    if (itemsChanged) {
      if (cart.length === 0 && serviceItems.length === 0) {
        setError("Добавьте товар или услугу.");
        return;
      }
      if (serviceItems.some((i) => !i.name.trim())) {
        setError("Укажите название каждой услуги.");
        return;
      }
      // Seller-side price floor check, mirrors CreateSaleModal.
      if (user?.role === "seller") {
        for (const c of cart) {
          if (c.price < (c.product.sale_price ?? 0)) {
            setError(`Цена "${c.product.name}" ниже прайса (${c.product.sale_price})`);
            return;
          }
        }
      }
    }

    if (discountVal < 0) {
      setError("Скидка не может быть отрицательной.");
      return;
    }
    if (paidVal < 0) {
      setError("Оплачено не может быть отрицательным.");
      return;
    }

    const payload: UpdateSalePayload = {
      customer_name: customerName.trim() || null,
      payment_type: paymentType,
      notes: notes.trim() || null,
      paid: paidVal,
      discount: discountVal,
    };

    if (itemsChanged) {
      const productItems = cart.map((c) => ({
        product_id: c.product.id,
        quantity: c.quantity,
        price: c.price,
      }));
      const serviceItemsPayload = serviceItems.map((s) => ({
        name: s.name.trim(),
        unit: s.unit.trim() || undefined,
        quantity: s.quantity,
        price: parseDecimal(s.price) || 0,
      }));
      payload.items = [...productItems, ...serviceItemsPayload] as UpdateSalePayload["items"];
    }

    const bytes = await Crypto.getRandomBytesAsync(16);
    const idempotencyKey = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    try {
      const updated = await updateMutation.mutateAsync({
        id: sale.id,
        payload,
        idempotencyKey,
      });
      showToast({ message: "Продажа обновлена", variant: "success" });
      onSuccess(updated);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 404 && onMissing) {
        onMissing();
      } else if (e instanceof ApiError && e.status === 0) {
        Alert.alert(
          "Нет соединения",
          "Не удалось связаться с сервером. Попробуйте, когда восстановится интернет.",
        );
      } else if (e instanceof ApiError) {
        setError(e.describeErrors());
      } else {
        setError("Не удалось обновить продажу.");
      }
    }
  };

  // ── Render ──

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-white dark:bg-zinc-950">
        {/* Header */}
        <View className="flex-row items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <TouchableOpacity
            onPress={onClose}
            hitSlop={10}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
          >
            <MaterialIcons name="close" size={20} color="#475569" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="font-heading text-[17px] tracking-tight text-slate-900 dark:text-white">
              Редактировать продажу
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              {hasReturns ? "Возврат уже оформлен — изменить можно только оплату" : "Товары, услуги и оплата"}
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!!error && (
              <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
                <MaterialIcons name="error-outline" size={16} color="#ef4444" />
                <Text className="text-sm text-red-600 flex-1">{error}</Text>
              </View>
            )}

            {/* Customer */}
            <Input
              label="Покупатель"
              placeholder="Необязательно"
              value={customerName}
              onChangeText={setCustomerName}
              className="mb-4"
            />

            {/* ── Items section ── */}
            {hasReturns ? (
              <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-3 mb-4 flex-row items-start gap-2">
                <MaterialIcons name="info-outline" size={16} color="#d97706" />
                <Text className="text-xs text-amber-900 dark:text-amber-200 flex-1">
                  По этой продаже был оформлен возврат — позиции редактировать нельзя, чтобы не сломать историю возвратов. Можно изменить покупателя, способ оплаты, скидку, оплату и заметки.
                </Text>
              </View>
            ) : (
              <>
                {/* Products */}
                <View className="mb-2 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <MaterialIcons name="inventory-2" size={16} color="#0a7ea4" />
                    <Text className="font-heading text-[14px] tracking-tight text-slate-900 dark:text-white">
                      Товары{cart.length > 0 ? ` · ${cart.length}` : ""}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setPickerVisible(true)}
                    className="flex-row items-center gap-1 bg-primary-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg"
                  >
                    <MaterialIcons name="add" size={16} color="#0a7ea4" />
                    <Text className="text-xs font-semibold text-primary-500">Добавить товар</Text>
                  </TouchableOpacity>
                </View>

                {cart.length === 0 ? (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 items-center mb-4">
                    <Text variant="muted" className="text-center text-xs">
                      Товары не выбраны
                    </Text>
                  </View>
                ) : (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl mb-4 overflow-hidden">
                    {cart.map((c) => (
                      <CartRow
                        key={c.product.id}
                        item={c}
                        canEditPrice={canEditPrice}
                        onRemove={removeCartItem}
                        onPriceModeChange={updatePriceMode}
                        onQuantityChange={updateCartQuantity}
                        onQuantityBlur={finalizeCartQuantity}
                        onQuantityAdjust={adjustCartQuantity}
                        onMarkupChange={updateMarkup}
                        onPriceChange={updatePrice}
                      />
                    ))}
                  </View>
                )}

                {/* Services */}
                <View className="mb-2 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <MaterialIcons name="handyman" size={16} color="#0a7ea4" />
                    <Text className="font-heading text-[14px] tracking-tight text-slate-900 dark:text-white">
                      Услуги{serviceItems.length > 0 ? ` · ${serviceItems.length}` : ""}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={addServiceItem}
                    className="flex-row items-center gap-1 bg-primary-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg"
                  >
                    <MaterialIcons name="add" size={16} color="#0a7ea4" />
                    <Text className="text-xs font-semibold text-primary-500">Добавить услугу</Text>
                  </TouchableOpacity>
                </View>

                {serviceItems.length === 0 ? (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 items-center mb-4">
                    <Text variant="muted" className="text-center text-xs">
                      Услуги не добавлены
                    </Text>
                  </View>
                ) : (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl mb-4 overflow-hidden">
                    {serviceItems.map((item) => (
                      <ServiceItemRow
                        key={item.id}
                        item={item}
                        onPatch={updateServiceItem}
                        onRemove={removeServiceItem}
                        onQuantityChange={updateServiceQuantity}
                        onQuantityBlur={finalizeServiceQuantity}
                      />
                    ))}
                  </View>
                )}
              </>
            )}

            {/* Discount */}
            <Input
              label="Скидка"
              placeholder="0"
              value={discount}
              onChangeText={setDiscount}
              keyboardType="numeric"
              className="mb-3"
            />

            {/* Payment type */}
            <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 mb-2">
              Способ оплаты
            </Text>
            <View className="flex-row gap-2 mb-4">
              {(["cash", "card", "transfer"] as const).map((t) => {
                const active = paymentType === t;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setPaymentType(t)}
                    className={`flex-1 items-center gap-1.5 py-3 rounded-2xl border ${
                      active
                        ? "border-primary-500 bg-primary-100 dark:bg-primary-900/30"
                        : "border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                    }`}
                    style={active ? { borderWidth: 1.5 } : undefined}
                  >
                    <MaterialIcons
                      name={PAYMENT_ICONS[t]}
                      size={20}
                      color={active ? "#0a7ea4" : "#64748b"}
                    />
                    <Text
                      className={`text-[12.5px] font-semibold ${
                        active
                          ? "text-primary-600 dark:text-primary-300"
                          : "text-slate-700 dark:text-zinc-300"
                      }`}
                    >
                      {PAYMENT_LABELS[t]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Paid */}
            <Input
              label="Оплачено"
              placeholder="0"
              value={paid}
              onChangeText={setPaid}
              keyboardType="numeric"
              className="mb-3"
            />

            {/* Notes */}
            <Input
              label="Заметки"
              placeholder="Необязательно"
              value={notes}
              onChangeText={setNotes}
              className="mb-4"
            />

            {/* Summary */}
            <View className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 mb-6">
              <View className="flex-row justify-between mb-1.5">
                <Text className="text-[13px] text-slate-500 dark:text-zinc-400">Подытог</Text>
                <Text
                  className="font-heading text-[13px] tracking-tight text-slate-700 dark:text-zinc-200"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {fmt(subtotal)}
                </Text>
              </View>
              {discountVal > 0 && (
                <View className="flex-row justify-between mb-1.5">
                  <Text className="text-[13px] text-slate-500 dark:text-zinc-400">Скидка</Text>
                  <Text className="font-heading text-[13px] tracking-tight text-amber-500">
                    − {fmt(discountVal)}
                  </Text>
                </View>
              )}
              <View
                className="my-2 border-t border-dashed border-slate-200 dark:border-zinc-700"
                style={{ borderStyle: "dashed" }}
              />
              <View className="flex-row justify-between items-baseline mb-1.5">
                <Text className="text-[14px] font-semibold text-slate-900 dark:text-white">
                  К оплате
                </Text>
                <Text
                  className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {fmt(total)}
                </Text>
              </View>
              <View className="flex-row justify-between mb-1.5">
                <Text className="text-[13px] text-slate-500 dark:text-zinc-400">Оплачено</Text>
                <Text
                  className="font-heading text-[13px] tracking-tight text-slate-700 dark:text-zinc-200"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {fmt(paidVal)}
                </Text>
              </View>
              {unpaid > 0 && (
                <View className="flex-row justify-between mb-1.5">
                  <Text className="text-[13px] text-slate-500 dark:text-zinc-400">
                    Не доплачено
                  </Text>
                  <Text className="font-heading text-[13px] font-semibold tracking-tight text-red-500">
                    {fmt(unpaid)}
                  </Text>
                </View>
              )}
              {overpaid > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-[13px] text-slate-500 dark:text-zinc-400">
                    Переплата
                  </Text>
                  <Text className="font-heading text-[13px] font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
                    {fmt(overpaid)}
                  </Text>
                </View>
              )}
            </View>

            <Button
              size="lg"
              onPress={handleSave}
              loading={submitting}
              disabled={submitting}
            >
              Сохранить изменения
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {!hasReturns && (
        <ProductPicker
          visible={pickerVisible}
          products={products}
          onSelect={addToCart}
          onClose={() => setPickerVisible(false)}
          loading={productsLoading && products.length === 0}
          loadingMore={false}
          hasMore={false}
          onLoadMore={() => {}}
          canCreate={false}
          onRequestCreate={() => {}}
        />
      )}
    </Modal>
  );
}
