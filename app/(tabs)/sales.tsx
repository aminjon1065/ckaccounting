import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, FAB, Skeleton, Text } from "@/components/ui";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

import { SaleCard } from "@/components/sales/SaleCard";
import { CreateSaleModal } from "@/components/sales/CreateSaleModal";
import { useSales } from "@/hooks/useSales";
import { useIsOnline } from "@/lib/network/NetworkProvider";

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SalesScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const isOnline = useIsOnline();

  const {
    sales,
    setSales,
    loading,
    refreshing,
    loadingMore,
    error,
    handleRefresh,
    handleLoadMore,
    retryFetch,
  } = useSales({ token, user });

  const [createVisible, setCreateVisible] = React.useState(false);

  // Stable callback so memoized SaleCard doesn't break its prop equality.
  const handleSelectSale = React.useCallback(
    (id: string) => router.push(`/sales/${id}`),
    [router]
  );
  const renderSale = React.useCallback(
    ({ item }: { item: import("@/lib/api").Sale }) => (
      <SaleCard item={item} onSelect={handleSelectSale} />
    ),
    [handleSelectSale]
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <Text variant="h4">Продажи</Text>
        <Text variant="muted" className="mt-0.5">
          Учёт продаж
        </Text>
      </View>

      {!isOnline && (
        <View className="mx-4 mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/20">
          <Text className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Офлайн-режим
          </Text>
          <Text className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Показаны сохранённые продажи. Новые операции станут доступны после восстановления сети.
          </Text>
        </View>
      )}

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
            onPress={retryFetch}
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
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-long"
              title="Пока нет продаж"
              description="Запишите первую продажу — кнопка «+» в правом нижнем углу."
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <View className="flex-row items-center justify-center gap-2 py-4">
                <ActivityIndicator size="small" color="#0a7ea4" />
                <Text variant="muted">Загружается история…</Text>
              </View>
            ) : null
          }
          renderItem={renderSale}
        />
      )}

      {/* FAB */}
      <FAB onPress={() => setCreateVisible(true)} />

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
