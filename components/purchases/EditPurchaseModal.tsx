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

import { Button, Input, Text } from "@/components/ui";
import {
  api,
  ApiError,
  type Product,
  type Purchase,
  type UpdatePurchasePayload,
} from "@/lib/api";
import { useToast } from "@/store/toast";
import { fmt } from "@/lib/formatters";
import { reportError } from "@/lib/observability/reporter";
import { useUpdatePurchase } from "@/lib/queries/purchases";

// ─── Cart shape ──────────────────────────────────────────────────────────────
//
// The edit cart can be seeded from either:
//   • a Purchase.items entry (existing line — has `id`, no Product details
//     beyond name), or
//   • a Product selected from the picker (new line — full Product object).
// We carry the Product when available so the picker / inline qty buttons
// can show stock; for legacy lines we keep a synthetic Product-like stub.

interface CartItem {
  product: Product;
  quantity: number;
  price: number;
  markupPercent: string;
  /** Existing PurchaseItem id when this row was loaded from the server.
   *  Undefined for lines added during the edit session. The id isn't
   *  re-sent — the server replaces every item on `items` update — but
   *  we keep it so the UI can show "existing" vs "new" affordances. */
  existingItemId?: string;
}

// ─── Product picker ──────────────────────────────────────────────────────────
//
// Lean version of the picker from CreatePurchaseModal — no "create new
// product" CTA here, edit flow assumes the catalog is already populated.

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
    ? products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
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
          <Text variant="h5" className="flex-1 text-center">Выберите товар</Text>
          <View style={{ width: 22 }} />
        </View>
        <View className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800">
          <View className="flex-row items-center bg-slate-100 dark:bg-zinc-800 rounded-xl px-3 gap-2">
            <MaterialIcons name="search" size={18} color="#94a3b8" />
            <RNTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск товара…"
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
            <Text variant="muted" className="text-center py-10">Товары не найдены.</Text>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

// ─── Edit modal ──────────────────────────────────────────────────────────────

interface EditPurchaseModalProps {
  visible: boolean;
  purchase: Purchase;
  token: string;
  onClose: () => void;
  onSuccess: (updated: Purchase) => void;
  /** Server reported the purchase no longer exists — caller should evict it. */
  onMissing?: () => void;
}

export function EditPurchaseModal({
  visible,
  purchase,
  token,
  onClose,
  onSuccess,
  onMissing,
}: EditPurchaseModalProps) {
  const { showToast } = useToast();
  const updateMutation = useUpdatePurchase(token);
  const submitting = updateMutation.isPending;
  const [supplierName, setSupplierName] = React.useState(purchase.supplier_name ?? "");
  const [cart, setCart] = React.useState<CartItem[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [pickerVisible, setPickerVisible] = React.useState(false);
  const [error, setError] = React.useState("");

  // Track whether the user touched the items collection. If not, we send
  // a metadata-only patch (no `items` field) so the server doesn't run
  // the full rollback / re-apply path for a supplier rename.
  const itemsDirtyRef = React.useRef(false);

  // Seed the cart from the purchase whenever the modal opens.
  React.useEffect(() => {
    if (!visible) return;
    setSupplierName(purchase.supplier_name ?? "");
    itemsDirtyRef.current = false;
    setError("");
    const seeded: CartItem[] = (purchase.items ?? []).map((item) => ({
      // Synthetic stub: the detail endpoint returns product_name but not
      // the full Product object. Enough for the row UI; picker-added
      // lines carry the real Product so stock/markup hints show up.
      product: {
        id: item.product_id,
        name: item.product_name,
        stock_quantity: 0,
        cost_price: item.price,
      } as Product,
      quantity: item.quantity,
      price: item.price,
      markupPercent: "",
      existingItemId: item.id,
    }));
    setCart(seeded);
  }, [visible, purchase]);

  // Lazy-load the product catalog the first time the picker is opened.
  // We scope by the purchase's own shop so super_admin / multi-shop owners
  // can't accidentally pull in products from another shop.
  React.useEffect(() => {
    if (!visible || !pickerVisible || products.length > 0) return;
    const shopId = (purchase as { shop_id?: number | null }).shop_id ?? undefined;
    api.products
      .list(token, { limit: 200, shop_id: shopId })
      .then((res) => setProducts(res.data))
      .catch((e) => reportError(e, { tag: "edit-purchase-products-load" }));
  }, [visible, pickerVisible, products.length, purchase, token]);

  // ── Cart mutations ──

  const markItemsDirty = () => {
    itemsDirtyRef.current = true;
  };

  const addToCart = (p: Product) => {
    markItemsDirty();
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === p.id);
      if (existing) {
        return prev.map((c) =>
          c.product.id === p.id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }
      return [...prev, { product: p, quantity: 1, price: p.cost_price, markupPercent: "" }];
    });
  };

  const removeItem = (productId: string) => {
    markItemsDirty();
    setCart((prev) => prev.filter((c) => c.product.id !== productId));
  };

  const updateQty = (productId: string, delta: number) => {
    markItemsDirty();
    setCart((prev) =>
      prev
        .map((c) =>
          c.product.id === productId ? { ...c, quantity: c.quantity + delta } : c,
        )
        .filter((c) => c.quantity > 0),
    );
  };

  const updateQtyValue = (productId: string, value: string) => {
    markItemsDirty();
    const normalized = value.replace(",", ".");
    const quantity = Number(normalized);
    setCart((prev) =>
      prev.map((c) =>
        c.product.id === productId
          ? { ...c, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : c.quantity }
          : c,
      ),
    );
  };

  const updatePrice = (productId: string, price: string) => {
    markItemsDirty();
    const normalized = price.replace(",", ".");
    setCart((prev) =>
      prev.map((c) =>
        c.product.id === productId
          ? { ...c, price: isNaN(Number(normalized)) ? c.price : Number(normalized) }
          : c,
      ),
    );
  };

  const updateMarkup = (productId: string, markup: string) => {
    markItemsDirty();
    setCart((prev) =>
      prev.map((c) =>
        c.product.id === productId ? { ...c, markupPercent: markup } : c,
      ),
    );
  };

  const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  // ── Submit ──

  const handleSave = async () => {
    setError("");
    const itemsChanged = itemsDirtyRef.current;
    if (itemsChanged && cart.length === 0) {
      setError("Добавьте хотя бы один товар.");
      return;
    }

    const payload: UpdatePurchasePayload = {
      version: purchase.version,
      supplier_name: supplierName.trim() || null,
    };
    if (itemsChanged) {
      payload.items = cart.map((c) => ({
        product_id: c.product.id,
        quantity: c.quantity,
        price: c.price,
        ...(c.markupPercent && !isNaN(Number(c.markupPercent))
          ? { markup_percent: Number(c.markupPercent) }
          : {}),
      }));
    }

    const bytes = await Crypto.getRandomBytesAsync(16);
    const idempotencyKey = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    try {
      const updated = await updateMutation.mutateAsync({ id: purchase.id, payload, idempotencyKey });
      showToast({ message: "Закупка обновлена", variant: "success" });
      onSuccess(updated);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 404 && onMissing) {
        onMissing();
      } else if (e instanceof ApiError && e.status === 409) {
        setError("Закупка была изменена другим пользователем. Откройте экран заново.");
      } else if (e instanceof ApiError) {
        setError(e.describeErrors());
      } else {
        setError("Не удалось сохранить изменения.");
      }
    }
  };

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
              Редактировать закупку
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Поставщик и список товаров
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

            <Input
              label="Поставщик"
              placeholder="Необязательно"
              value={supplierName}
              onChangeText={setSupplierName}
              className="mb-4"
            />

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
                      <TouchableOpacity onPress={() => removeItem(c.product.id)} hitSlop={8}>
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

            {total > 0 && (
              <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 flex-row justify-between mb-6">
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">Итого</Text>
                <Text className="text-base font-bold text-primary-500">{fmt(total)}</Text>
              </View>
            )}

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

      <ProductPicker
        visible={pickerVisible}
        products={products}
        onSelect={addToCart}
        onClose={() => setPickerVisible(false)}
      />
    </Modal>
  );
}
