import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  TextInput as RNTextInput,
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
    retryFetch,
  } = useProducts({ token, user });

  const [formVisible, setFormVisible] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [scannerVisible, setScannerVisible] = React.useState(false);

  const openEdit = React.useCallback((item: Product) => {
    setEditing(item);
    setFormVisible(true);
  }, []);

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
    [router, openEdit, handleDelete, canEdit]
  );

  const keyExtractor = React.useCallback((item: Product) => String(item.id), []);

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
          <TouchableOpacity onPress={() => setScannerVisible(true)} hitSlop={8}>
            <MaterialIcons name="qr-code-scanner" size={20} color="#94a3b8" />
          </TouchableOpacity>
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
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="cloud-off" size={48} color="#94a3b8" />
          <Text variant="h5" className="mt-4 text-center">Ошибка загрузки</Text>
          <Text variant="muted" className="mt-1 text-center">{error}</Text>
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
          data={products}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
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
              <ActivityIndicator
                size="small"
                color="#0a7ea4"
                style={{ marginVertical: 16 }}
              />
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
        token={token!}
      />

      {/* Barcode scanner for product search */}
      <ScannerOverlay
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={(code) => {
          setScannerVisible(false);
          // Try exact match first
          const exact = products.find(
            (p) => p.code && p.code.toLowerCase() === code.toLowerCase()
          );
          if (exact) {
            router.push(`/products/${exact.id}`);
          } else {
            // Fall back to filtering by the scanned code
            handleSearchChange(code);
          }
        }}
      />
    </SafeAreaView>
  );
}
