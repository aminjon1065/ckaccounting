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

import { Skeleton, Text } from "@/components/ui";
import { api, type Purchase } from "@/lib/api";
import { can } from "@/lib/permissions";
import { CreatePurchaseModal } from "@/components/purchases/CreatePurchaseModal";
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

  const fetchPurchases = React.useCallback(async (reset = false) => {
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
  }, [page, token]);

  React.useEffect(() => {
    fetchPurchases(true).finally(() => setLoading(false));
  }, [fetchPurchases]);

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
