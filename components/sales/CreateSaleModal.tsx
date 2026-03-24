import * as React from "react";
import { Modal, TouchableOpacity, View, FlatList, TextInput as RNTextInput, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text, Button, Input, Skeleton, Badge } from "@/components/ui";
import { api, ApiError, type CreateSalePayload, type Product, type Sale, type SaleType } from "@/lib/api";
import { ProductPicker } from "./ProductPicker";
import { fmt, PRICE_MODE_LABELS, PAYMENT_ICONS, PAYMENT_LABELS } from "./helpers";
import { PriceMode, CartItem, ServiceLineItem } from "./types";

export function CreateSaleModal({
  visible,
  onClose,
  onCreated,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (s: Sale) => void;
  token: string;
}) {
  const [saleType, setSaleType] = React.useState<SaleType>("product");

  // Product sale state
  const [products, setProducts] = React.useState<Product[]>([]);
  const [cart, setCart] = React.useState<CartItem[]>([]);
  const [pickerVisible, setPickerVisible] = React.useState(false);

  // Service sale state
  const [serviceItems, setServiceItems] = React.useState<ServiceLineItem[]>([]);
  const serviceIdRef = React.useRef(0);

  // Shared state
  const [customerName, setCustomerName] = React.useState("");
  const [discount, setDiscount] = React.useState("");
  const [paid, setPaid] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [paymentType, setPaymentType] = React.useState<"cash" | "card" | "transfer">("cash");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Reset everything when modal opens
  React.useEffect(() => {
    if (!visible) return;
    setSaleType("product");
    setCart([]); setServiceItems([]);
    setCustomerName(""); setDiscount("");
    setPaid(""); setNotes("");
    setPaymentType("cash"); setError("");
    serviceIdRef.current = 0;
    api.products
      .list(token, { limit: 100 })
      .then((res) => setProducts(res.data))
      .catch(() => {});
  }, [visible]);

  // ── Product cart helpers ────────────────────────────────────────────────────

  function addToCart(p: Product) {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === p.id);
      if (existing) {
        return prev.map((c) =>
          c.product.id === p.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { product: p, quantity: 1, price: p.sale_price, priceMode: "fixed" as PriceMode, markupPercent: "" }];
    });
  }

  function updateQty(productId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((c) =>
          c.product.id === productId ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0)
    );
  }

  function updatePrice(productId: number, price: string) {
    setCart((prev) =>
      prev.map((c) =>
        c.product.id === productId
          ? { ...c, price: isNaN(Number(price)) ? c.price : Number(price) }
          : c
      )
    );
  }

  function updatePriceMode(productId: number, mode: PriceMode) {
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.id !== productId) return c;
        let price = c.price;
        if (mode === "fixed") price = c.product.sale_price;
        if (mode === "auto" && c.markupPercent && !isNaN(Number(c.markupPercent))) {
          price = c.product.cost_price * (1 + Number(c.markupPercent) / 100);
        }
        return { ...c, priceMode: mode, price };
      })
    );
  }

  function updateMarkup(productId: number, markup: string) {
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.id !== productId) return c;
        const price = markup && !isNaN(Number(markup))
          ? c.product.cost_price * (1 + Number(markup) / 100)
          : c.price;
        return { ...c, markupPercent: markup, price };
      })
    );
  }

  // ── Service item helpers ────────────────────────────────────────────────────

  function addServiceItem() {
    const id = String(serviceIdRef.current++);
    setServiceItems((prev) => [
      ...prev,
      { id, name: "", unit: "шт", quantity: 1, price: "" },
    ]);
  }

  function updateServiceItem(id: string, patch: Partial<ServiceLineItem>) {
    setServiceItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function removeServiceItem(id: string) {
    setServiceItems((prev) => prev.filter((item) => item.id !== id));
  }

  // ── Calculations ────────────────────────────────────────────────────────────

  const subtotal =
    saleType === "product"
      ? cart.reduce((s, c) => s + c.price * c.quantity, 0)
      : serviceItems.reduce((s, i) => s + (parseFloat(i.price) || 0) * i.quantity, 0);
  const discountVal = parseFloat(discount) || 0;
  const total = Math.max(0, subtotal - discountVal);
  const paidVal = parseFloat(paid) || 0;
  const debt = Math.max(0, total - paidVal);

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setError("");

    if (saleType === "product") {
      if (cart.length === 0) { setError("Добавьте хотя бы один товар."); return; }
    } else {
      if (serviceItems.length === 0) { setError("Добавьте хотя бы одну услугу."); return; }
      if (serviceItems.some((i) => !i.name.trim())) {
        setError("Укажите название каждой услуги."); return;
      }
    }

    setSubmitting(true);
    try {
      const payload: CreateSalePayload = {
        type: saleType,
        payment_type: paymentType,
        items:
          saleType === "product"
            ? cart.map((c) => ({
                product_id: c.product.id,
                quantity: c.quantity,
                price: c.price,
              }))
            : serviceItems.map((s) => ({
                name: s.name.trim(),
                unit: s.unit.trim() || undefined,
                quantity: s.quantity,
                price: parseFloat(s.price) || 0,
              })),
      };
      if (customerName.trim()) payload.customer_name = customerName.trim();
      if (discountVal > 0) payload.discount = discountVal;
      if (paidVal > 0) payload.paid = paidVal;
      if (notes.trim()) payload.notes = notes.trim();

      const created = await api.sales.create(payload, token);
      onCreated(created);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Что-то пошло не так.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-white dark:bg-zinc-950">
        {/* Header */}
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">
            Новая продажа
          </Text>
          <View style={{ width: 22 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <ScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Error */}
            {!!error && (
              <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
                <MaterialIcons name="error-outline" size={16} color="#ef4444" />
                <Text className="text-sm text-red-600 flex-1">{error}</Text>
              </View>
            )}

            {/* ── Sale type toggle ─────────────────────────────────────────── */}
            <View className="flex-row bg-slate-100 dark:bg-zinc-800 rounded-xl p-1 mb-5">
              {(["product", "service"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setSaleType(t)}
                  className={`flex-1 flex-row items-center justify-center gap-2 py-2.5 rounded-lg ${
                    saleType === t
                      ? "bg-white dark:bg-zinc-900"
                      : ""
                  }`}
                >
                  <MaterialIcons
                    name={t === "product" ? "inventory-2" : "handyman"}
                    size={16}
                    color={saleType === t ? "#0a7ea4" : "#94a3b8"}
                  />
                  <Text
                    className={`text-sm font-semibold ${
                      saleType === t
                        ? "text-primary-500"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {t === "product" ? "Товары" : "Услуги"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Customer */}
            <Input
              label="Покупатель"
              placeholder="Необязательно"
              value={customerName}
              onChangeText={setCustomerName}
              className="mb-4"
            />

            {/* ── Product cart ─────────────────────────────────────────────── */}
            {saleType === "product" && (
              <>
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    Товары ({cart.length})
                  </Text>
                  <TouchableOpacity
                    onPress={() => setPickerVisible(true)}
                    className="flex-row items-center gap-1 bg-primary-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg"
                  >
                    <MaterialIcons name="add" size={16} color="#0a7ea4" />
                    <Text className="text-xs font-semibold text-primary-500">
                      Добавить товар
                    </Text>
                  </TouchableOpacity>
                </View>

                {cart.length === 0 ? (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-6 items-center mb-4">
                    <MaterialIcons name="shopping-cart" size={32} color="#94a3b8" />
                    <Text variant="muted" className="mt-2 text-center text-sm">
                      Нет товаров
                    </Text>
                  </View>
                ) : (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl mb-4 overflow-hidden">
                    {cart.map((c) => (
                      <View
                        key={c.product.id}
                        className="p-3 border-b border-slate-200 dark:border-zinc-700 last:border-0"
                      >
                        <View className="flex-row items-center justify-between mb-1.5">
                          <Text className="text-sm font-medium text-slate-900 dark:text-slate-50 flex-1 mr-2">
                            {c.product.name}
                          </Text>
                          <TouchableOpacity
                            onPress={() =>
                              setCart((prev) =>
                                prev.filter((x) => x.product.id !== c.product.id)
                              )
                            }
                            hitSlop={8}
                          >
                            <MaterialIcons name="close" size={16} color="#94a3b8" />
                          </TouchableOpacity>
                        </View>
                        {/* Price mode toggle */}
                        <View className="flex-row bg-slate-200 dark:bg-zinc-700 rounded-lg p-0.5 mb-2">
                          {(["fixed", "manual", "auto"] as const).map((m) => (
                            <TouchableOpacity
                              key={m}
                              onPress={() => updatePriceMode(c.product.id, m)}
                              className={`flex-1 py-1.5 rounded-md items-center ${
                                c.priceMode === m ? "bg-white dark:bg-zinc-900" : ""
                              }`}
                            >
                              <Text
                                className={`text-xs font-medium ${
                                  c.priceMode === m
                                    ? "text-primary-500"
                                    : "text-slate-400 dark:text-slate-500"
                                }`}
                              >
                                {PRICE_MODE_LABELS[m]}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <View className="flex-row items-center gap-3">
                          <View className="flex-row items-center gap-2">
                            <TouchableOpacity
                              onPress={() => updateQty(c.product.id, -1)}
                              className="w-7 h-7 rounded-full bg-slate-200 dark:bg-zinc-700 items-center justify-center"
                            >
                              <MaterialIcons name="remove" size={14} color="#64748b" />
                            </TouchableOpacity>
                            <Text className="text-sm font-semibold w-6 text-center text-slate-900 dark:text-slate-50">
                              {c.quantity}
                            </Text>
                            <TouchableOpacity
                              onPress={() => updateQty(c.product.id, 1)}
                              className="w-7 h-7 rounded-full bg-slate-200 dark:bg-zinc-700 items-center justify-center"
                            >
                              <MaterialIcons name="add" size={14} color="#64748b" />
                            </TouchableOpacity>
                          </View>
                          {c.priceMode === "auto" ? (
                            <View className="flex-1">
                              <Input
                                value={c.markupPercent}
                                onChangeText={(v) => updateMarkup(c.product.id, v)}
                                keyboardType="numeric"
                                placeholder="Наценка %"
                                className="py-1 text-xs"
                              />
                            </View>
                          ) : (
                            <View className="flex-1">
                              <Input
                                value={String(c.price)}
                                onChangeText={(v) => updatePrice(c.product.id, v)}
                                keyboardType="numeric"
                                placeholder="Цена"
                                className="py-1 text-xs"
                                editable={c.priceMode === "manual"}
                              />
                            </View>
                          )}
                          <Text className="text-sm font-semibold text-primary-500 w-20 text-right">
                            {fmt(c.price * c.quantity)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* ── Service items ────────────────────────────────────────────── */}
            {saleType === "service" && (
              <>
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    Услуги ({serviceItems.length})
                  </Text>
                  <TouchableOpacity
                    onPress={addServiceItem}
                    className="flex-row items-center gap-1 bg-primary-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg"
                  >
                    <MaterialIcons name="add" size={16} color="#0a7ea4" />
                    <Text className="text-xs font-semibold text-primary-500">
                      Добавить
                    </Text>
                  </TouchableOpacity>
                </View>

                {serviceItems.length === 0 ? (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-6 items-center mb-4">
                    <MaterialIcons name="handyman" size={32} color="#94a3b8" />
                    <Text variant="muted" className="mt-2 text-center text-sm">
                      Нет услуг
                    </Text>
                  </View>
                ) : (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl mb-4 overflow-hidden">
                    {serviceItems.map((item) => (
                      <View
                        key={item.id}
                        className="p-3 border-b border-slate-200 dark:border-zinc-700 last:border-0"
                      >
                        {/* Row 1: name + delete */}
                        <View className="flex-row items-center gap-2 mb-2">
                          <RNTextInput
                            value={item.name}
                            onChangeText={(v) => updateServiceItem(item.id, { name: v })}
                            placeholder="Название услуги"
                            placeholderTextColor="#94a3b8"
                            className="flex-1 text-sm text-slate-900 dark:text-slate-50 bg-white dark:bg-zinc-900 rounded-lg px-3 py-2"
                          />
                          <TouchableOpacity
                            onPress={() => removeServiceItem(item.id)}
                            hitSlop={8}
                          >
                            <MaterialIcons name="close" size={16} color="#94a3b8" />
                          </TouchableOpacity>
                        </View>

                        {/* Row 2: unit + qty stepper + price + total */}
                        <View className="flex-row items-center gap-2">
                          {/* Unit */}
                          <RNTextInput
                            value={item.unit}
                            onChangeText={(v) => updateServiceItem(item.id, { unit: v })}
                            placeholder="Ед."
                            placeholderTextColor="#94a3b8"
                            className="w-14 text-xs text-slate-900 dark:text-slate-50 bg-white dark:bg-zinc-900 rounded-lg px-2 py-1.5 text-center"
                          />
                          {/* Qty stepper */}
                          <View className="flex-row items-center gap-1.5">
                            <TouchableOpacity
                              onPress={() =>
                                updateServiceItem(item.id, {
                                  quantity: Math.max(1, item.quantity - 1),
                                })
                              }
                              className="w-7 h-7 rounded-full bg-slate-200 dark:bg-zinc-700 items-center justify-center"
                            >
                              <MaterialIcons name="remove" size={14} color="#64748b" />
                            </TouchableOpacity>
                            <Text className="text-sm font-semibold w-6 text-center text-slate-900 dark:text-slate-50">
                              {item.quantity}
                            </Text>
                            <TouchableOpacity
                              onPress={() =>
                                updateServiceItem(item.id, { quantity: item.quantity + 1 })
                              }
                              className="w-7 h-7 rounded-full bg-slate-200 dark:bg-zinc-700 items-center justify-center"
                            >
                              <MaterialIcons name="add" size={14} color="#64748b" />
                            </TouchableOpacity>
                          </View>
                          {/* Price */}
                          <View className="flex-1">
                            <Input
                              value={item.price}
                              onChangeText={(v) => updateServiceItem(item.id, { price: v })}
                              keyboardType="numeric"
                              placeholder="Цена"
                              className="py-1 text-xs"
                            />
                          </View>
                          {/* Line total */}
                          <Text className="text-sm font-semibold text-primary-500 w-20 text-right">
                            {fmt((parseFloat(item.price) || 0) * item.quantity)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* ── Discount ─────────────────────────────────────────────────── */}
            <Input
              label="Скидка"
              placeholder="0"
              value={discount}
              onChangeText={setDiscount}
              keyboardType="numeric"
              className="mb-3"
            />

            {/* ── Payment type ─────────────────────────────────────────────── */}
            <Text className="text-xs font-medium text-slate-500 mb-2">
              Способ оплаты
            </Text>
            <View className="flex-row gap-2 mb-4">
              {(["cash", "card", "transfer"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setPaymentType(t)}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl border ${
                    paymentType === t
                      ? "bg-primary-500 border-primary-500"
                      : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                  }`}
                >
                  <MaterialIcons
                    name={PAYMENT_ICONS[t]}
                    size={16}
                    color={paymentType === t ? "#fff" : "#94a3b8"}
                  />
                  <Text
                    className={`text-xs font-medium ${
                      paymentType === t
                        ? "text-white"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {PAYMENT_LABELS[t]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Paid ─────────────────────────────────────────────────────── */}
            <Input
              label="Оплачено"
              placeholder={fmt(total)}
              value={paid}
              onChangeText={setPaid}
              keyboardType="numeric"
              hint="Оставьте пустым для полной оплаты"
              className="mb-3"
            />

            {/* ── Notes ────────────────────────────────────────────────────── */}
            <Input
              label="Заметки"
              placeholder="Необязательно"
              value={notes}
              onChangeText={setNotes}
              className="mb-4"
            />

            {/* ── Summary ──────────────────────────────────────────────────── */}
            <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 gap-2 mb-6">
              <View className="flex-row justify-between">
                <Text variant="muted">Подытог</Text>
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {fmt(subtotal)}
                </Text>
              </View>
              {discountVal > 0 && (
                <View className="flex-row justify-between">
                  <Text variant="muted">Скидка</Text>
                  <Text className="text-sm font-medium text-amber-500">
                    − {fmt(discountVal)}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between border-t border-slate-200 dark:border-zinc-700 pt-2 mt-1">
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Сумма
                </Text>
                <Text className="text-base font-bold text-slate-900 dark:text-slate-50">
                  {fmt(total)}
                </Text>
              </View>
              {paidVal > 0 && paidVal < total && (
                <View className="flex-row justify-between">
                  <Text variant="muted">Остаток долга</Text>
                  <Text className="text-sm font-semibold text-red-500">
                    {fmt(debt)}
                  </Text>
                </View>
              )}
            </View>

            <Button
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              Записать продажу
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Product picker — only rendered for product type */}
      {saleType === "product" && (
        <ProductPicker
          visible={pickerVisible}
          products={products}
          onSelect={addToCart}
          onClose={() => setPickerVisible(false)}
        />
      )}
    </Modal>
  );
}
