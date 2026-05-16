import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import * as Crypto from "expo-crypto";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Text, Select } from "@/components/ui";
import {
  api,
  ApiError,
  type CreatePurchasePayload,
  type Product,
  type Purchase,
  type Shop,
} from "@/lib/api";
import { useToast } from "@/store/toast";
import { useAuth } from "@/store/auth";
import { fmt } from "@/lib/formatters";
import { reportError } from "@/lib/observability/reporter";
import { can, effectiveShopId, needsShopPicker, pickerShopIds } from "@/lib/permissions";
import { ProductFormModal } from "@/components/products/ProductFormModal";

// ─── Product picker ───────────────────────────────────────────────────────────

function ProductPicker({
  visible,
  products,
  canCreate,
  onSelect,
  onClose,
  onRequestCreate,
}: {
  visible: boolean;
  products: Product[];
  /** If false, hide the "Create new product" CTA (e.g. read-only role). */
  canCreate: boolean;
  onSelect: (p: Product) => void;
  onClose: () => void;
  /** Caller opens its ProductFormModal pre-filled with this name. */
  onRequestCreate: (initialName: string) => void;
}) {
  const [search, setSearch] = React.useState("");
  const filtered = search
    ? products.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase())
      )
    : products;

  // CTA visibility: always render it when the user has a non-trivial search
  // (so they can create a brand-new SKU even when partial matches exist),
  // or when the list is empty and they have no search yet. Power users on
  // a busy supplier delivery can type "Mol" and immediately tap "Create
  // 'Mol'" rather than scrolling through the catalog.
  const trimmedSearch = search.trim();
  const showCreateCta = canCreate && (trimmedSearch.length > 0 || filtered.length === 0);

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
          <Text variant="h5" className="flex-1 text-center">Выберите товар</Text>
          <View style={{ width: 22 }} />
        </View>
        <View className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800">
          <View className="flex-row items-center bg-slate-100 dark:bg-zinc-800 rounded-xl px-3 gap-2">
            <MaterialIcons name="search" size={18} color="#94a3b8" />
            <RNTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск или название нового товара…"
              placeholderTextColor="#94a3b8"
              className="flex-1 py-2.5 text-sm text-slate-900 dark:text-slate-50"
            />
          </View>
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            showCreateCta ? (
              <TouchableOpacity
                onPress={() => onRequestCreate(trimmedSearch)}
                className="flex-row items-center gap-3 py-3.5 mb-1 border-b border-slate-100 dark:border-zinc-800"
              >
                <View className="w-9 h-9 rounded-full bg-primary-50 dark:bg-blue-900/20 items-center justify-center">
                  <MaterialIcons name="add" size={20} color="#0a7ea4" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-primary-500">
                    {trimmedSearch
                      ? `Создать «${trimmedSearch}»`
                      : "Создать новый товар"}
                  </Text>
                  <Text variant="small">
                    Добавить в каталог прямо отсюда.
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => { onSelect(item); onClose(); setSearch(""); }}
              className="flex-row items-center py-3.5 border-b border-slate-100 dark:border-zinc-800"
            >
              <View className="flex-1">
                <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
                  {item.name}
                </Text>
                <Text variant="small">Остаток: {item.stock_quantity}</Text>
              </View>
              <Text className="text-sm font-semibold text-primary-500">
                Закупка: {fmt(item.cost_price)}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            showCreateCta ? null : (
              <Text variant="muted" className="text-center py-10">Товары не найдены.</Text>
            )
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

// ─── Cart item type ───────────────────────────────────────────────────────────

interface CartItem {
  product: Product;
  quantity: number;
  price: number;
  markupPercent: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Create purchase modal ────────────────────────────────────────────────────

export function CreatePurchaseModal({
  visible,
  onClose,
  onCreated,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (p: Purchase) => void;
  token: string;
}) {
  const [products, setProducts] = React.useState<Product[]>([]);
  const [cart, setCart] = React.useState<CartItem[]>([]);
  const [pickerVisible, setPickerVisible] = React.useState(false);
  const [supplierName, setSupplierName] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const { showToast } = useToast();
  const { user } = useAuth();
  const showShopPicker = needsShopPicker(user);
  const implicitShopId = effectiveShopId(user);
  const allowedShopIds = React.useMemo(() => pickerShopIds(user), [user]);
  const [shopId, setShopId] = React.useState<string>("");
  const [shops, setShops] = React.useState<Shop[]>([]);
  // Inline create flow from the product picker. We carry the seed name so
  // the form opens pre-filled with whatever the user was searching for.
  const [createProductVisible, setCreateProductVisible] = React.useState(false);
  const [createProductSeed, setCreateProductSeed] = React.useState("");
  const canCreateProduct = can(user?.role, "products:edit");

  React.useEffect(() => {
    if (!visible) return;
    setCart([]); setSupplierName(""); setError("");
    setShopId("");
    if (showShopPicker) {
      api.shops.list(token)
        .then((res) => {
          const list = res.data ?? [];
          setShops(allowedShopIds == null ? list : list.filter((s) => allowedShopIds.includes(s.id)));
        })
        .catch((e) => reportError(e, { tag: "purchase-modal-shops-load" }));
    }
  }, [token, visible, showShopPicker, allowedShopIds]);

  React.useEffect(() => {
    if (!visible) return;
    const targetShop = showShopPicker
      ? (shopId ? Number(shopId) : null)
      : implicitShopId;
    if (showShopPicker && targetShop === null) {
      // Picker visible but nothing picked — leave product list empty.
      setProducts([]);
      return;
    }
    api.products.list(token, { limit: 100, shop_id: targetShop ?? undefined })
      .then((res) => setProducts(res.data))
      .catch(() => {});
  }, [token, visible, showShopPicker, shopId, implicitShopId]);

  function addToCart(p: Product) {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === p.id);
      if (existing) {
        return prev.map((c) =>
          c.product.id === p.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { product: p, quantity: 1, price: p.cost_price, markupPercent: "" }];
    });
  }

  function handleProductCreated(saved: Product) {
    // Make sure the picker's product list includes the new SKU so a
    // subsequent open of the picker still shows it.
    setProducts((prev) => (prev.some((p) => p.id === saved.id) ? prev : [saved, ...prev]));
    addToCart(saved);
    setCreateProductVisible(false);
    setCreateProductSeed("");
    // Close the picker too — the user just got what they came for; staying
    // in the picker would feel like an extra tap.
    setPickerVisible(false);
    showToast({ message: "Товар добавлен в каталог и в приход", variant: "success" });
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) =>
          c.product.id === productId ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0)
    );
  }

  function updateQtyValue(productId: string, value: string) {
    const normalized = value.replace(",", ".");
    const quantity = Number(normalized);

    setCart((prev) =>
      prev.map((c) =>
        c.product.id === productId
          ? { ...c, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : c.quantity }
          : c
      )
    );
  }

  function updatePrice(productId: string, price: string) {
    setCart((prev) =>
      prev.map((c) =>
        c.product.id === productId
          ? { ...c, price: isNaN(Number(price)) ? c.price : Number(price) }
          : c
      )
    );
  }

  function updateMarkup(productId: string, markup: string) {
    setCart((prev) =>
      prev.map((c) =>
        c.product.id === productId ? { ...c, markupPercent: markup } : c
      )
    );
  }

  const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  async function handleSubmit() {
    setError("");
    if (cart.length === 0) { setError("Добавьте хотя бы один товар."); return; }
    setSubmitting(true);
    const bytes = await Crypto.getRandomBytesAsync(16);
    const idempotencyKey = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    const payload: CreatePurchasePayload = {
      items: cart.map((c) => ({
        product_id: c.product.id,
        quantity: c.quantity,
        price: c.price,
        ...(c.markupPercent && !isNaN(Number(c.markupPercent))
          ? { markup_percent: Number(c.markupPercent) }
          : {}),
      })),
    };
    if (supplierName.trim()) payload.supplier_name = supplierName.trim();
    if (showShopPicker) {
      if (!shopId) { setError("Выберите магазин."); setSubmitting(false); return; }
      payload.shop_id = Number(shopId);
    } else if (implicitShopId !== null) {
      payload.shop_id = implicitShopId;
    } else {
      setError("Магазин не назначен."); setSubmitting(false); return;
    }
    try {
      const created = await api.purchases.create(payload, token, idempotencyKey);
      onCreated(created);
      showToast({ message: "Приход добавлен", variant: "success" });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Что-то пошло не так.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-white dark:bg-zinc-950">
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
              Новая закупка
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Поставщик и список товаров
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView
          behavior="padding"
          className="flex-1"
        >
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

            {/* ── Shop Selector ── */}
            {showShopPicker && (
              <View className="mb-4">
                <Select
                  label="Магазин"
                  required
                  value={shopId}
                  onValueChange={setShopId}
                  options={shops.map(s => ({ label: s.name, value: String(s.id) }))}
                  placeholder="Выберите магазин"
                />
              </View>
            )}

            <Input
              label="Поставщик"
              placeholder="Необязательно"
              value={supplierName}
              onChangeText={setSupplierName}
              className="mb-4"
            />

            {/* Items */}
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                Товары ({cart.length})
              </Text>
              <TouchableOpacity
                onPress={() => setPickerVisible(true)}
                className="flex-row items-center gap-1 bg-primary-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg"
              >
                <MaterialIcons name="add" size={16} color="#0a7ea4" />
                <Text className="text-xs font-semibold text-primary-500">Добавить товар</Text>
              </TouchableOpacity>
            </View>

            {cart.length === 0 ? (
              <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-6 items-center mb-4">
                <MaterialIcons name="inventory" size={32} color="#94a3b8" />
                <Text variant="muted" className="mt-2 text-sm">Нет товаров</Text>
              </View>
            ) : (
              <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl mb-4 overflow-hidden">
                {cart.map((c) => (
                  <View
                    key={c.product.id}
                    className="p-3 border-b border-slate-200 dark:border-zinc-700"
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
                        <Input
                          value={String(c.quantity)}
                          onChangeText={(v) => updateQtyValue(c.product.id, v)}
                          keyboardType="numeric"
                          selectTextOnFocus
                          containerClassName="w-20"
                          className="text-center text-sm font-semibold"
                        />
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
                          placeholder="Цена закупки"
                          className="py-1 text-xs"
                        />
                      </View>
                      <Text className="text-sm font-semibold text-primary-500 w-20 text-right">
                        {fmt(c.price * c.quantity)}
                      </Text>
                    </View>
                    {/* Markup row */}
                    <View className="flex-row items-center gap-3 mt-2">
                      <View className="flex-1">
                        <Input
                          value={c.markupPercent}
                          onChangeText={(v) => updateMarkup(c.product.id, v)}
                          keyboardType="numeric"
                          placeholder="Наценка %"
                          className="py-1 text-xs"
                        />
                      </View>
                      {c.markupPercent !== "" && !isNaN(Number(c.markupPercent)) && (
                        <Text className="text-xs text-slate-500 dark:text-slate-400">
                          Продажа: {fmt(c.price * (1 + Number(c.markupPercent) / 100))}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Total */}
            {total > 0 && (
              <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 flex-row justify-between mb-6">
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">Итого</Text>
                <Text className="text-base font-bold text-primary-500">{fmt(total)}</Text>
              </View>
            )}

            <Button
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              Создать закупку
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ProductPicker
        visible={pickerVisible}
        products={products}
        canCreate={canCreateProduct}
        onSelect={addToCart}
        onClose={() => setPickerVisible(false)}
        onRequestCreate={(seedName) => {
          setCreateProductSeed(seedName);
          setCreateProductVisible(true);
        }}
      />

      {canCreateProduct && (
        <ProductFormModal
          visible={createProductVisible}
          editing={null}
          initialName={createProductSeed}
          // Lock the new product to the purchase's shop. Without this, a
          // super-admin / multi-shop owner could pick another shop in the
          // product form, and the purchase submit would fail with 404
          // (product visible only inside its own shop scope).
          initialShopId={
            showShopPicker
              ? (shopId ? Number(shopId) : null)
              : implicitShopId
          }
          onClose={() => {
            setCreateProductVisible(false);
            setCreateProductSeed("");
          }}
          onSaved={handleProductCreated}
          token={token}
        />
      )}
    </Modal>
  );
}
