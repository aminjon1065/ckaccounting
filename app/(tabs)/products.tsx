import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
  type CreateProductPayload,
  type Product,
} from "@/lib/api";
import { useAuth } from "@/store/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function stockColor(p: Product) {
  if (p.stock_quantity === 0) return "text-red-500";
  if (p.low_stock_alert != null && p.stock_quantity <= p.low_stock_alert)
    return "text-amber-500";
  return "text-green-600";
}

// ─── Product card ─────────────────────────────────────────────────────────────

function ProductCard({
  item,
  onEdit,
  onDelete,
}: {
  item: Product;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isLow =
    item.low_stock_alert != null && item.stock_quantity <= item.low_stock_alert;
  const isOut = item.stock_quantity === 0;

  return (
    <TouchableOpacity
      onLongPress={() =>
        Alert.alert(item.name, "Выберите действие", [
          { text: "Изменить", onPress: onEdit },
          {
            text: "Удалить",
            style: "destructive",
            onPress: onDelete,
          },
          { text: "Отмена", style: "cancel" },
        ])
      }
      onPress={onEdit}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 shadow-sm border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      {/* Top row */}
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 mr-3">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {item.name}
          </Text>
          <Text variant="small">
            {[item.code, item.unit].filter(Boolean).join(" · ") || "—"}
          </Text>
        </View>
        {isOut ? (
          <Badge variant="destructive">Нет в наличии</Badge>
        ) : isLow ? (
          <Badge variant="warning">Мало</Badge>
        ) : null}
      </View>

      {/* Prices row */}
      <View className="flex-row gap-4">
        <View>
          <Text variant="small">Закупка</Text>
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {fmt(item.cost_price)}
          </Text>
        </View>
        <View>
          <Text variant="small">Продажа</Text>
          <Text className="text-sm font-semibold text-primary-500">
            {fmt(item.sale_price)}
          </Text>
        </View>
        <View className="flex-1 items-end">
          <Text variant="small">Остаток</Text>
          <Text className={`text-sm font-semibold ${stockColor(item)}`}>
            {item.stock_quantity} {item.unit ?? ""}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Form modal ───────────────────────────────────────────────────────────────

interface FormModalProps {
  visible: boolean;
  editing: Product | null;
  onClose: () => void;
  onSaved: (p: Product) => void;
  token: string;
}

function ProductFormModal({
  visible,
  editing,
  onClose,
  onSaved,
  token,
}: FormModalProps) {
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [costPrice, setCostPrice] = React.useState("");
  const [salePrice, setSalePrice] = React.useState("");
  const [stock, setStock] = React.useState("");
  const [lowAlert, setLowAlert] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Refs for focus chain
  const codeRef = React.useRef<RNTextInput>(null);
  const unitRef = React.useRef<RNTextInput>(null);
  const costRef = React.useRef<RNTextInput>(null);
  const saleRef = React.useRef<RNTextInput>(null);
  const stockRef = React.useRef<RNTextInput>(null);
  const alertRef = React.useRef<RNTextInput>(null);

  React.useEffect(() => {
    if (visible && editing) {
      setName(editing.name);
      setCode(editing.code ?? "");
      setUnit(editing.unit ?? "");
      setCostPrice(String(editing.cost_price));
      setSalePrice(String(editing.sale_price));
      setStock(String(editing.stock_quantity));
      setLowAlert(editing.low_stock_alert != null ? String(editing.low_stock_alert) : "");
    } else if (visible && !editing) {
      setName(""); setCode(""); setUnit("");
      setCostPrice(""); setSalePrice("");
      setStock(""); setLowAlert("");
    }
    setError("");
  }, [visible, editing]);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите название товара."); return; }
    if (!costPrice || isNaN(Number(costPrice))) { setError("Некорректная цена закупки."); return; }
    if (!salePrice || isNaN(Number(salePrice))) { setError("Некорректная цена продажи."); return; }
    if (!stock || isNaN(Number(stock))) { setError("Некорректное количество."); return; }

    setSubmitting(true);
    try {
      const payload: CreateProductPayload = {
        name: name.trim(),
        cost_price: parseFloat(costPrice),
        sale_price: parseFloat(salePrice),
        stock_quantity: parseFloat(stock),
      };
      if (code.trim()) payload.code = code.trim();
      if (unit.trim()) payload.unit = unit.trim();
      if (lowAlert.trim() && !isNaN(Number(lowAlert)))
        payload.low_stock_alert = parseFloat(lowAlert);

      const saved = editing
        ? await api.products.update(editing.id, payload, token)
        : await api.products.create(payload, token);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Что-то пошло не так. Попробуйте снова."
      );
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
        {/* Header */}
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">
            {editing ? "Изменить товар" : "Добавить товар"}
          </Text>
          <View style={{ width: 22 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <ScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!!error && (
              <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
                <MaterialIcons name="error-outline" size={16} color="#ef4444" />
                <Text className="text-sm text-red-600 dark:text-red-400 flex-1">{error}</Text>
              </View>
            )}

            <View className="gap-4">
              <Input
                label="Название товара"
                required
                placeholder="напр. Беспроводная мышь"
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                onSubmitEditing={() => codeRef.current?.focus()}
              />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    ref={codeRef}
                    label="Код / Артикул"
                    placeholder="напр. WM-001"
                    value={code}
                    onChangeText={setCode}
                    returnKeyType="next"
                    onSubmitEditing={() => unitRef.current?.focus()}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    ref={unitRef}
                    label="Ед. изм."
                    placeholder="напр. шт"
                    value={unit}
                    onChangeText={setUnit}
                    returnKeyType="next"
                    onSubmitEditing={() => costRef.current?.focus()}
                  />
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    ref={costRef}
                    label="Цена закупки"
                    required
                    placeholder="0"
                    value={costPrice}
                    onChangeText={setCostPrice}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => saleRef.current?.focus()}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    ref={saleRef}
                    label="Цена продажи"
                    required
                    placeholder="0"
                    value={salePrice}
                    onChangeText={setSalePrice}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => stockRef.current?.focus()}
                  />
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    ref={stockRef}
                    label="Количество"
                    required
                    placeholder="0"
                    value={stock}
                    onChangeText={setStock}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => alertRef.current?.focus()}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    ref={alertRef}
                    label="Порог остатка"
                    placeholder="напр. 5"
                    value={lowAlert}
                    onChangeText={setLowAlert}
                    keyboardType="numeric"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                </View>
              </View>
            </View>

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              {editing ? "Сохранить" : "Добавить товар"}
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const { token } = useAuth();

  const [products, setProducts] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const searchDebounce = React.useRef<ReturnType<typeof setTimeout>>();

  const [formVisible, setFormVisible] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);

  async function fetchProducts(
    reset = false,
    searchVal = search
  ) {
    if (!token) return;
    const pg = reset ? 1 : page;
    try {
      const res = await api.products.list(token, {
        page: pg,
        search: searchVal || undefined,
      });
      if (reset) {
        setProducts(res.data);
        setPage(2);
      } else {
        setProducts((prev) => [...prev, ...res.data]);
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e) {
      console.error("Products fetch error:", e);
    }
  }

  React.useEffect(() => {
    fetchProducts(true).finally(() => setLoading(false));
  }, [token]);

  function handleRefresh() {
    setRefreshing(true);
    fetchProducts(true).finally(() => setRefreshing(false));
  }

  function handleLoadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    fetchProducts(false).finally(() => setLoadingMore(false));
  }

  function handleSearchChange(text: string) {
    setSearch(text);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setLoading(true);
      fetchProducts(true, text).finally(() => setLoading(false));
    }, 400);
  }

  function handleDelete(id: number) {
    Alert.alert("Удалить товар", "Товар будет удалён безвозвратно.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await api.products.delete(id, token!);
            setProducts((prev) => prev.filter((p) => p.id !== id));
          } catch (e) {
            Alert.alert("Ошибка", "Не удалось удалить товар.");
          }
        },
      },
    ]);
  }

  function handleSaved(saved: Product) {
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <Text variant="h4">Товары</Text>
        <Text variant="muted" className="mt-0.5">
          Управление складом
        </Text>
      </View>

      {/* Search bar */}
      <View className="px-4 py-3 bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800">
        <View className="flex-row items-center bg-slate-100 dark:bg-zinc-800 rounded-xl px-3 gap-2">
          <MaterialIcons name="search" size={18} color="#94a3b8" />
          <RNTextInput
            value={search}
            onChangeText={handleSearchChange}
            placeholder="Поиск товаров…"
            placeholderTextColor="#94a3b8"
            className="flex-1 py-2.5 text-sm text-slate-900 dark:text-slate-50"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <View key={i} className="mb-3">
              <Skeleton className="h-24 rounded-2xl" />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-20">
              <MaterialIcons name="inventory-2" size={48} color="#94a3b8" />
              <Text variant="muted" className="mt-3 text-center">
                {search ? "Товары не найдены." : "Нет товаров.\nНажмите + для добавления."}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                size="small"
                color="#0a7ea4"
                style={{ marginVertical: 16 }}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <ProductCard
              item={item}
              onEdit={() => {
                setEditing(item);
                setFormVisible(true);
              }}
              onDelete={() => handleDelete(item.id)}
            />
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => {
          setEditing(null);
          setFormVisible(true);
        }}
        className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg active:opacity-80"
        style={{ elevation: 6 }}
      >
        <MaterialIcons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Form modal */}
      <ProductFormModal
        visible={formVisible}
        editing={editing}
        onClose={() => setFormVisible(false)}
        onSaved={handleSaved}
        token={token!}
      />
    </SafeAreaView>
  );
}
