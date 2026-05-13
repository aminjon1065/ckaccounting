import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge, EmptyState, FAB, Skeleton, Text } from "@/components/ui";
import { type Purchase } from "@/lib/api";
import { can } from "@/lib/permissions";
import { CreatePurchaseModal } from "@/components/purchases/CreatePurchaseModal";
import { useAuth } from "@/store/auth";
import { usePurchases } from "@/hooks/usePurchases";
import { fmt } from "@/lib/formatters";
import { DEFAULT_CURRENCY } from "@/constants/config";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function shortId(id: string): string {
  return `P-${id.replace(/-/g, "").slice(-4).toUpperCase()}`;
}

// ─── Purchase card ───────────────────────────────────────────────────────────

const PurchaseCard = React.memo(function PurchaseCard({
  item,
  onPress,
}: {
  item: Purchase;
  onPress: () => void;
}) {
  // Backend doesn't surface `paid`/`debt` on Purchase yet. We keep the card
  // flexible: when those fields are present we render the badge, otherwise
  // we fall back to a paid pill.
  const paid = (item as any).paid as number | undefined;
  const debt = paid != null ? Math.max(0, item.total - paid) : 0;
  const hasDebt = debt > 0;
  return (
    <Pressable
      onPress={onPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-3.5 mb-2.5 border border-slate-200 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-start mb-2">
        <View className="flex-1 mr-3 min-w-0">
          <Text
            className="text-[15px] font-semibold text-slate-900 dark:text-white"
            numberOfLines={1}
          >
            {item.supplier_name || "Неизвестный поставщик"}
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {shortId(item.id)} · {fmtShortDate(item.created_at)} · {(item.items ?? []).length} поз.
          </Text>
        </View>
        <View className="items-end">
          <Text
            className="font-heading text-[16px] tracking-tight text-slate-900 dark:text-white"
            style={{ fontVariantLigatures: "none" }}
          >
            {fmt(item.total)}
          </Text>
          <Text className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {DEFAULT_CURRENCY}
          </Text>
        </View>
      </View>
      {hasDebt ? (
        <Badge variant="destructive">Долг {fmt(debt)} {DEFAULT_CURRENCY}</Badge>
      ) : (
        <Badge variant="success">Оплачено</Badge>
      )}
    </Pressable>
  );
});

// ─── Main screen ─────────────────────────────────────────────────────────────

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

  // Period stats — month label + total, total outstanding debt across all rows.
  const stats = React.useMemo(() => {
    const total = purchases.reduce((s, p) => s + p.total, 0);
    const debt = purchases.reduce((s, p) => {
      const paid = (p as any).paid as number | undefined;
      return s + (paid != null ? Math.max(0, p.total - paid) : 0);
    }, 0);
    return { total, debt, count: purchases.length };
  }, [purchases]);

  if (!can(user?.role, "purchases:view")) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="lock" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">
          Нет доступа
        </Text>
        <Text variant="muted" className="mt-2 text-center">
          У вас нет прав для просмотра закупок.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center gap-2 px-4 pt-4 pb-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="arrow-back" size={20} color="#475569" />
        </Pressable>
        <View className="flex-1">
          <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white">
            Закупки
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            История прихода товара
          </Text>
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-2">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="mb-2.5">
              <Skeleton className="h-[88px] rounded-2xl" />
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
          data={purchases}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            purchases.length > 0 ? (
              <View className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40 rounded-2xl p-3.5 mb-3 flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 items-center justify-center">
                  <MaterialIcons name="inventory" size={20} color="#10b981" />
                </View>
                <View className="flex-1">
                  <Text className="text-[12px] text-emerald-800/80 dark:text-emerald-300/80">
                    {stats.count} закупок
                  </Text>
                  <Text
                    className="font-heading text-[18px] tracking-tight text-emerald-700 dark:text-emerald-300"
                    style={{ fontVariantLigatures: "none" }}
                  >
                    {fmt(stats.total)} {DEFAULT_CURRENCY}
                  </Text>
                </View>
                {stats.debt > 0 && (
                  <Badge variant="destructive">Долг {fmt(stats.debt)}</Badge>
                )}
              </View>
            ) : null
          }
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
            <PurchaseCard item={item} onPress={() => router.push(`/purchases/${item.id}`)} />
          )}
        />
      )}

      {can(user?.role, "purchases:create") && (
        <FAB onPress={() => setCreateVisible(true)} />
      )}

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
