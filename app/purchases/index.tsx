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
import { type Purchase } from "@/lib/api";
import { can } from "@/lib/permissions";
import { CreatePurchaseModal } from "@/components/purchases/CreatePurchaseModal";
import { useAuth } from "@/store/auth";
import { usePurchases } from "@/hooks/usePurchases";
import { fmt } from "@/lib/formatters";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Purchase card ────────────────────────────────────────────────────────────

const PurchaseCard = React.memo(function PurchaseCard({
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
});



// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PurchasesScreen() {
  const { token, user } = useAuth();
  const router = useRouter();

  const {
    purchases,
    setPurchases,
    loading,
    refreshing,
    loadingMore,
    error,
    handleRefresh,
    handleLoadMore,
    retryFetch,
  } = usePurchases({ token, user });

  const [createVisible, setCreateVisible] = React.useState(false);

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
            onPress={retryFetch}
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
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <EmptyState
              icon="shopping-bag"
              title="Закупок пока нет"
              description="Запишите первую закупку у поставщика — кнопка «+» в правом нижнем углу."
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
          renderItem={({ item }) => (
            <PurchaseCard
              item={item}
              onPress={() => router.push(`/purchases/${item.id}`)}
            />
          )}
        />
      )}

      {/* FAB */}
      {can(user?.role, "purchases:create") && (
        <FAB onPress={() => setCreateVisible(true)} />
      )}

      {/* Create modal */}
      <CreatePurchaseModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(p) => {
          setPurchases((prev) => [p, ...prev]);
        }}
        token={token!}
      />
    </SafeAreaView>
  );
}
