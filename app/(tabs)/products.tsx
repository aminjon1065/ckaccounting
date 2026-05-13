import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  TextInput as RNTextInput,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, FAB, Skeleton, Text } from "@/components/ui";
import { type Product } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuth } from "@/store/auth";

import { ProductCard } from "@/components/products/ProductCard";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { ScannerOverlay } from "@/components/ScannerOverlay";
import { useProducts } from "@/hooks/useProducts";

type StockFilter = "all" | "low" | "out";

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const { token, user } = useAuth();
  const router = useRouter();
  const canEdit = can(user?.role, "products:edit");

  const {
    products,
    loading,
    refreshing,
    loadingMore,
    search,
    error,
    handleRefresh,
    handleLoadMore,
    handleSearchChange,
    handleDelete,
    handleSaved,
    dropLocalProduct,
    retryFetch,
  } = useProducts({ token, user });

  const [formVisible, setFormVisible] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [scannerVisible, setScannerVisible] = React.useState(false);
  const [stockFilter, setStockFilter] = React.useState<StockFilter>("all");

  const openEdit = React.useCallback((item: Product) => {
    setEditing(item);
    setFormVisible(true);
  }, []);

  // Client-side stock filter on top of whatever the server returned. Search is
  // already server-driven via `useProducts`; this adds the "show only low/out
  // of stock" knob without a new query parameter.
  const filteredProducts = React.useMemo(() => {
    if (stockFilter === "all") return products;
    return products.filter((p) => {
      const out = p.stock_quantity === 0;
      const low =
        p.low_stock_alert != null && p.stock_quantity <= p.low_stock_alert && !out;
      if (stockFilter === "out") return out;
      if (stockFilter === "low") return low || out;
      return true;
    });
  }, [products, stockFilter]);

  // Counters for the chip badges.
  const counts = React.useMemo(() => {
    let out = 0;
    let low = 0;
    for (const p of products) {
      if (p.stock_quantity === 0) {
        out += 1;
      } else if (p.low_stock_alert != null && p.stock_quantity <= p.low_stock_alert) {
        low += 1;
      }
    }
    return { all: products.length, low: low + out, out };
  }, [products]);

  const renderItem = React.useCallback(
    ({ item }: { item: Product }) => (
      <ProductCard
        item={item}
        onViewDetail={() => router.push(`/products/${item.id}`)}
        onEdit={() => openEdit(item)}
        onDelete={() => handleDelete(item.id)}
        canEdit={canEdit}
      />
    ),
    [router, openEdit, handleDelete, canEdit],
  );

  const keyExtractor = React.useCallback((item: Product) => String(item.id), []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 pt-4 pb-3 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800">
        <View className="flex-1 min-w-0">
          <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white">
            Товары
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {counts.all} наименований
            {counts.out > 0 ? ` · ${counts.out} нет в наличии` : ""}
          </Text>
        </View>
        <Pressable
          onPress={() => setScannerVisible(true)}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="qr-code-scanner" size={20} color="#475569" />
        </Pressable>
      </View>

      {/* Search */}
      <View className="px-4 pt-3 pb-2 bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800">
        <View className="flex-row items-center bg-slate-100 dark:bg-zinc-800 rounded-xl px-3 gap-2">
          <MaterialIcons name="search" size={18} color="#94a3b8" />
          <RNTextInput
            value={search}
            onChangeText={handleSearchChange}
            placeholder="Поиск по названию или коду"
            placeholderTextColor="#94a3b8"
            className="flex-1 py-2.5 text-[14px] text-slate-900 dark:text-white"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* Filter chips */}
      <View className="bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 6 }}
        >
          <FilterChip
            label="Все"
            count={counts.all}
            active={stockFilter === "all"}
            onPress={() => setStockFilter("all")}
          />
          <FilterChip
            label="Мало"
            count={counts.low}
            active={stockFilter === "low"}
            onPress={() => setStockFilter("low")}
            tone="warning"
          />
          <FilterChip
            label="Нет в наличии"
            count={counts.out}
            active={stockFilter === "out"}
            onPress={() => setStockFilter("out")}
            tone="destructive"
          />
        </ScrollView>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <View key={i} className="mb-2.5">
              <Skeleton className="h-[96px] rounded-2xl" />
            </View>
          ))}
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="cloud-off" size={48} color="#94a3b8" />
          <Text variant="h5" className="mt-4 text-center">
            Ошибка загрузки
          </Text>
          <Text variant="muted" className="mt-1 text-center">
            {error}
          </Text>
          <TouchableOpacity
            onPress={retryFetch}
            className="mt-4 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl"
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100 }}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            search ? (
              <EmptyState
                icon="search-off"
                title="Ничего не найдено"
                description={`По запросу «${search}» товары не найдены. Попробуйте другое слово или штрихкод.`}
              />
            ) : stockFilter !== "all" ? (
              <EmptyState
                icon="check-circle"
                title="Тут пусто — это хорошо"
                description={
                  stockFilter === "out"
                    ? "Нет товаров без остатка."
                    : "Нет товаров на пороге низкого остатка."
                }
              />
            ) : (
              <EmptyState
                icon="inventory-2"
                title="Каталог пустой"
                description="Добавьте первый товар — нажмите «+» в правом нижнем углу."
              />
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color="#0a7ea4" style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={renderItem}
        />
      )}

      {/* FAB */}
      {canEdit && (
        <FAB
          onPress={() => {
            setEditing(null);
            setFormVisible(true);
          }}
        />
      )}

      {/* Form modal */}
      <ProductFormModal
        visible={formVisible}
        editing={editing}
        onClose={() => setFormVisible(false)}
        onSaved={(saved, wasEditing) => handleSaved(saved, wasEditing)}
        onMissing={(id) => {
          dropLocalProduct(id).catch(() => {});
        }}
        token={token!}
      />

      {/* Barcode scanner */}
      <ScannerOverlay
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={(code) => {
          setScannerVisible(false);
          const exact = products.find(
            (p) => p.code && p.code.toLowerCase() === code.toLowerCase(),
          );
          if (exact) {
            router.push(`/products/${exact.id}`);
          } else {
            handleSearchChange(code);
          }
        }}
      />
    </SafeAreaView>
  );
}

// ─── Filter chip ─────────────────────────────────────────────────────────────

function FilterChip({
  label,
  count,
  active,
  onPress,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
  tone?: "warning" | "destructive";
}) {
  const activeBg =
    tone === "warning"
      ? "bg-amber-500 border-amber-500"
      : tone === "destructive"
        ? "bg-red-500 border-red-500"
        : "bg-primary-500 border-primary-500";
  return (
    <Pressable
      onPress={onPress}
      className={`px-3.5 py-1.5 rounded-full border flex-row items-center gap-1.5 active:opacity-80 ${
        active
          ? activeBg
          : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
      }`}
    >
      <Text
        className={`text-[13px] font-semibold ${
          active ? "text-white" : "text-slate-700 dark:text-zinc-300"
        }`}
      >
        {label}
      </Text>
      {count > 0 && (
        <View
          className={`px-1.5 py-px rounded-full min-w-[18px] items-center ${
            active ? "bg-white/25" : "bg-slate-200 dark:bg-zinc-800"
          }`}
        >
          <Text
            className={`text-[10.5px] font-bold ${
              active ? "text-white" : "text-slate-600 dark:text-zinc-300"
            }`}
          >
            {count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
