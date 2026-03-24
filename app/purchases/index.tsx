import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
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

import { Button, Input, Skeleton, Text } from "@/components/ui";
import {
  api,
  ApiError,
  type CreatePurchasePayload,
  type Product,
  type Purchase,
} from "@/lib/api";
import { can } from "@/lib/permissions";
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
  return d.toLocaleDateString("ru-RU", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Purchase card ────────────────────────────────────────────────────────────

function PurchaseCard({
  item,
  onPress,
}: {
  item: Purchase;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-start justify-between mb-1">
        <View className="flex-1 mr-2">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {item.supplier_name || "Неизвестный поставщик"}
          </Text>
          <Text variant="small">{fmtDate(item.created_at)}</Text>
        </View>
        <Text className="text-base font-bold text-primary-500">
          {fmt(item.total)}
        </Text>
      </View>
      <Text variant="small">
        {(item.items ?? []).length} поз.
      </Text>
    </TouchableOpacity>
  );
}

// ─── Product picker ───────────────────────────────────────────────────────────

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
    ? products.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase())
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
          <Text variant="h5" className="flex-1 text-center">Выберите товар</Text>
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

// ─── Cart item type ───────────────────────────────────────────────────────────

interface CartItem {
  product: Product;
  quantity: number;
  price: number;
  markupPercent: string;
}

// ─── Create purchase modal ────────────────────────────────────────────────────

function CreatePurchaseModal({
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

  React.useEffect(() => {
    if (!visible) return;
    setCart([]); setSupplierName(""); setError("");
    api.products
      .list(token, { limit: 100 })
      .then((res) => setProducts(res.data))
      .catch(() => {});
  }, [visible]);

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

  function updateMarkup(productId: number, markup: string) {
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
    try {
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
      const created = await api.purchases.create(payload, token);
      onCreated(created);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Что-то пошло не так.");
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
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">Новая закупка</Text>
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
        onSelect={addToCart}
        onClose={() => setPickerVisible(false)}
      />
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PurchasesScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();

  const [purchases, setPurchases] = React.useState<Purchase[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [createVisible, setCreateVisible] = React.useState(false);
  const [error, setError] = React.useState("");

  async function fetchPurchases(reset = false) {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");
    try {
      const res = await api.purchases.list(token, { page: pg });
      if (reset) {
        setPurchases(res.data);
        setPage(2);
      } else {
        setPurchases((prev) => [...prev, ...res.data]);
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e) {
      console.error("Purchases fetch error:", e);
      if (reset) setError("Не удалось загрузить закупки.");
    }
  }

  React.useEffect(() => {
    fetchPurchases(true).finally(() => setLoading(false));
  }, [token]);

  if (!can(user?.role, "purchases:view")) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="lock" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">Нет доступа</Text>
        <Text variant="muted" className="mt-2 text-center">
          У вас нет прав для просмотра закупок.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text variant="h4">Закупки</Text>
          <Text variant="muted" className="mt-0.5">История закупок</Text>
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3].map((i) => (
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
            onPress={() => { setLoading(true); fetchPurchases(true).finally(() => setLoading(false)); }}
            className="mt-4 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl"
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={purchases}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchPurchases(true).finally(() => setRefreshing(false));
          }}
          onEndReached={() => {
            if (!hasMore || loadingMore) return;
            setLoadingMore(true);
            fetchPurchases(false).finally(() => setLoadingMore(false));
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <MaterialIcons name="shopping-bag" size={48} color="#94a3b8" />
              <Text variant="muted" className="mt-3 text-center">
                Закупок нет.{"\n"}Нажмите + для записи.
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color="#0a7ea4" style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={({ item }) => (
            <PurchaseCard
              item={item}
              onPress={() => router.push(`/purchases/${item.id}`)}
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
      <CreatePurchaseModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(p) => {
          setPurchases((prev) => [p, ...prev]);
          showToast({ message: "Закупка создана", variant: "success" });
        }}
        token={token!}
      />
    </SafeAreaView>
  );
}
