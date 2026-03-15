import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge, Button, Input, Skeleton, Text } from "@/components/ui";
import {
  api,
  ApiError,
  type CreateSalePayload,
  type Product,
  type Sale,
  type SaleType,
} from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { month: "short", day: "numeric", year: "numeric" });
}

const PAYMENT_ICONS: Record<string, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  cash: "payments",
  card: "credit-card",
  transfer: "swap-horiz",
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Нал.",
  card: "Карта",
  transfer: "Перевод",
};

// ─── Cart / service types ─────────────────────────────────────────────────────

interface CartItem {
  product: Product;
  quantity: number;
  price: number;
}

interface ServiceLineItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  price: string; // kept as string for the TextInput
}

// ─── Sale card ────────────────────────────────────────────────────────────────

function SaleCard({ item, onPress }: { item: Sale; onPress: () => void }) {
  const hasDebt = item.debt > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {item.customer_name || "Покупатель"}
          </Text>
          <Text variant="small">{fmtDate(item.created_at)}</Text>
        </View>
        <View className="items-end gap-1">
          <Text className="text-base font-bold text-slate-900 dark:text-slate-50">
            {fmt(item.total)}
          </Text>
          {hasDebt && (
            <Badge variant="destructive">Долг {fmt(item.debt)}</Badge>
          )}
        </View>
      </View>

      <View className="flex-row items-center gap-2 mt-1">
        <View className="flex-row items-center gap-1 bg-slate-100 dark:bg-zinc-800 rounded-lg px-2 py-1">
          <MaterialIcons
            name={PAYMENT_ICONS[item.payment_type] ?? "payments"}
            size={13}
            color="#0a7ea4"
          />
          <Text className="text-xs text-slate-600 dark:text-slate-400">
            {PAYMENT_LABELS[item.payment_type] ?? item.payment_type}
          </Text>
        </View>
        {item.type === "service" ? (
          <Badge variant="secondary">Услуга</Badge>
        ) : (
          <Text variant="small">{item.items.length} поз.</Text>
        )}
        {item.discount > 0 && (
          <Text variant="small">Скидка: {fmt(item.discount)}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Product picker modal ─────────────────────────────────────────────────────

function ProductPicker({
  visible,
  products,
  onSelect,
  onClose,
}: {
  visible: boolean;
  products: Product[];
  onSelect: (p: Product) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = React.useState("");

  const filtered = search
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.code && p.code.toLowerCase().includes(search.toLowerCase()))
      )
    : products;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-white dark:bg-zinc-950">
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">
            Выберите товар
          </Text>
          <View style={{ width: 22 }} />
        </View>

        <View className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800">
          <View className="flex-row items-center bg-slate-100 dark:bg-zinc-800 rounded-xl px-3 gap-2">
            <MaterialIcons name="search" size={18} color="#94a3b8" />
            <RNTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск…"
              placeholderTextColor="#94a3b8"
              className="flex-1 py-2.5 text-sm text-slate-900 dark:text-slate-50"
            />
          </View>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => { onSelect(item); onClose(); setSearch(""); }}
              className="flex-row items-center py-3.5 border-b border-slate-100 dark:border-zinc-800 active:opacity-70"
            >
              <View className="flex-1">
                <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
                  {item.name}
                </Text>
                <Text variant="small">
                  {item.code ? `${item.code} · ` : ""}Остаток: {item.stock_quantity}
                </Text>
              </View>
              <Text className="text-sm font-semibold text-primary-500">
                {fmt(item.sale_price)}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text variant="muted" className="text-center py-10">
              Товары не найдены.
            </Text>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

// ─── Create sale modal ────────────────────────────────────────────────────────

function CreateSaleModal({
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
      return [...prev, { product: p, quantity: 1, price: p.sale_price }];
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
                          <View className="flex-1">
                            <Input
                              value={String(c.price)}
                              onChangeText={(v) => updatePrice(c.product.id, v)}
                              keyboardType="numeric"
                              placeholder="Цена"
                              className="py-1 text-xs"
                            />
                          </View>
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

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SalesScreen() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();

  const [sales, setSales] = React.useState<Sale[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [createVisible, setCreateVisible] = React.useState(false);
  const [error, setError] = React.useState("");

  async function fetchSales(reset = false) {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");
    try {
      const res = await api.sales.list(token, { page: pg });
      if (reset) {
        setSales(res.data);
        setPage(2);
      } else {
        setSales((prev) => [...prev, ...res.data]);
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e) {
      console.error("Sales fetch error:", e);
      if (reset) setError("Не удалось загрузить продажи.");
    }
  }

  React.useEffect(() => {
    fetchSales(true).finally(() => setLoading(false));
  }, [token]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <Text variant="h4">Продажи</Text>
        <Text variant="muted" className="mt-0.5">
          Учёт продаж
        </Text>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="mb-3">
              <Skeleton className="h-20 rounded-2xl" />
            </View>
          ))}
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="cloud-off" size={48} color="#94a3b8" />
          <Text variant="h5" className="mt-4 text-center">Ошибка загрузки</Text>
          <Text variant="muted" className="mt-1 text-center">{error}</Text>
          <TouchableOpacity
            onPress={() => { setLoading(true); fetchSales(true).finally(() => setLoading(false)); }}
            className="mt-4 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl"
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sales}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchSales(true).finally(() => setRefreshing(false));
          }}
          onEndReached={() => {
            if (!hasMore || loadingMore) return;
            setLoadingMore(true);
            fetchSales(false).finally(() => setLoadingMore(false));
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <MaterialIcons name="receipt-long" size={48} color="#94a3b8" />
              <Text variant="muted" className="mt-3 text-center">
                Продаж нет.{"\n"}Нажмите + для записи.
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color="#0a7ea4" style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={({ item }) => (
            <SaleCard
              item={item}
              onPress={() => router.push(`/sales/${item.id}`)}
            />
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => setCreateVisible(true)}
        className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg active:opacity-80"
        style={{ elevation: 6 }}
      >
        <MaterialIcons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Create modal */}
      <CreateSaleModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(s) => {
          setSales((prev) => [s, ...prev]);
          showToast({ message: "Продажа записана", variant: "success" });
        }}
        token={token!}
      />
    </SafeAreaView>
  );
}
