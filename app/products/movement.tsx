import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { FlatList, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge, Skeleton, Text } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { ApiError, type ProductMovement, type ProductMovementType } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useIsOnline } from "@/lib/network/NetworkProvider";
import { useProductMovements } from "@/lib/queries/products";
import { fmt } from "@/lib/formatters";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Movement type config ─────────────────────────────────────────────────────

const MOVEMENT_CONFIG: Record<
  ProductMovementType,
  { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; bg: string; iconColor: string; sign: "+" | "−" }
> = {
  purchase: {
    label: "Приход",
    icon: "arrow-downward",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    iconColor: "#10b981",
    sign: "+",
  },
  sale: {
    label: "Продажа",
    icon: "arrow-upward",
    bg: "bg-blue-50 dark:bg-blue-900/20",
    iconColor: "#3b82f6",
    sign: "−",
  },
  return: {
    label: "Возврат",
    icon: "undo",
    bg: "bg-amber-50 dark:bg-amber-900/20",
    iconColor: "#f59e0b",
    sign: "+",
  },
  write_off: {
    label: "Списание",
    icon: "remove-circle-outline",
    bg: "bg-orange-50 dark:bg-orange-900/20",
    iconColor: "#f97316",
    sign: "−",
  },
};

// ─── Movement row ─────────────────────────────────────────────────────────────

function MovementRow({ item }: { item: ProductMovement }) {
  const cfg = MOVEMENT_CONFIG[item.type] ?? MOVEMENT_CONFIG.write_off;
  const isPositive = item.type === "purchase";

  return (
    <View className="flex-row items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-zinc-800 last:border-0">
      {/* Icon */}
      <View
        className={`w-9 h-9 rounded-full items-center justify-center ${cfg.bg}`}
      >
        <MaterialIcons name={cfg.icon} size={18} color={cfg.iconColor} />
      </View>

      {/* Middle: type + date + actor */}
      <View className="flex-1">
        <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {cfg.label}
        </Text>
        <Text variant="muted" className="text-xs mt-0.5">
          {fmtDate(item.created_at)}
        </Text>
        {item.actor_name && (
          <Text variant="muted" className="text-xs">
            {item.actor_name}
          </Text>
        )}
      </View>

      {/* Right: qty + total */}
      <View className="items-end">
        <Text
          className={`text-sm font-bold ${
            isPositive
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-700 dark:text-slate-300"
          }`}
        >
          {cfg.sign}
          {item.quantity}
        </Text>
        <Text variant="muted" className="text-xs mt-0.5">
          {fmt(item.total)} {DEFAULT_CURRENCY}
        </Text>
      </View>
    </View>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <View className="px-4 py-3 gap-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} className="flex-row items-center gap-3">
          <Skeleton className="w-9 h-9 rounded-full" />
          <View className="flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-3 w-32 rounded" />
          </View>
          <View className="items-end gap-1.5">
            <Skeleton className="h-3.5 w-10 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProductMovementScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { token } = useAuth();
  const router = useRouter();
  const isOnline = useIsOnline();

  const query = useProductMovements(id, token);
  const {
    data,
    error,
    isPending,
    isFetching,
    isRefetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = query;

  // Flatten paged data. Current stock comes from the latest page header.
  const movements = React.useMemo<ProductMovement[]>(
    () => (data?.pages ?? []).flatMap((p) => p.movements),
    [data],
  );
  const currentStock = data?.pages[0]?.current_stock ?? null;

  const loading = isPending && movements.length === 0;
  const hardError = !!error && movements.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1 mr-3">
          <Text variant="h5" numberOfLines={1}>
            {name ?? "Движение товара"}
          </Text>
          {isFetching && !isRefetching && movements.length > 0 && (
            <Text variant="muted" className="text-xs mt-0.5">Обновляется…</Text>
          )}
        </View>
        {currentStock !== null && (
          <Badge variant="secondary">{currentStock} шт.</Badge>
        )}
      </View>

      {/* Sub-header: summary strip */}
      {!loading && !error && movements.length > 0 && (
        <View className="flex-row bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800 px-4 py-2 gap-4">
          {((["purchase", "sale", "return", "write_off"]) as ProductMovementType[]).map((t) => {
            const cfg = MOVEMENT_CONFIG[t];
            const count = movements.filter((m) => m.type === t).length;
            return (
              <View key={t} className="flex-row items-center gap-1.5">
                <MaterialIcons name={cfg.icon} size={14} color={cfg.iconColor} />
                <Text variant="muted" className="text-xs">
                  {cfg.label}: <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300">{count}</Text>
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Body */}
      {loading ? (
        <SkeletonRows />
      ) : hardError ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons
            name={isOnline ? "error-outline" : "cloud-off"}
            size={48}
            color="#94a3b8"
          />
          <Text variant="h5" className="mt-4 text-center">
            {isOnline ? "Ошибка загрузки" : "Нет соединения"}
          </Text>
          <Text variant="muted" className="mt-1 text-center">
            {isOnline
              ? error instanceof ApiError
                ? error.message
                : "Попробуйте ещё раз."
              : "История обновится автоматически, когда вернётся интернет."}
          </Text>
          <TouchableOpacity
            onPress={() => refetch().catch(() => {})}
            className="mt-4 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl"
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : movements.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="swap-vert" size={52} color="#cbd5e1" />
          <Text variant="h5" className="mt-4 text-center text-slate-400">
            Нет операций
          </Text>
          <Text variant="muted" className="mt-1 text-center text-sm">
            История движения товара появится после первой операции
          </Text>
        </View>
      ) : (
        <FlatList
          data={movements}
          // Movements come from three different tables joined on the
          // backend — no shared primary key. Compose a stable key from
          // the reference tuple plus index as a tie-breaker (two items
          // sharing the same reference_id from different types is
          // possible, e.g. sale + return of the same sale).
          keyExtractor={(item, index) =>
            `${item.reference_type ?? "x"}-${item.reference_id ?? "n"}-${item.created_at}-${index}`
          }
          renderItem={({ item }) => <MovementRow item={item} />}
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => null}
          refreshing={isRefetching}
          onRefresh={() => refetch().catch(() => {})}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage().catch(() => {});
            }
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="items-center py-4">
                <Text variant="muted" className="text-sm">Загрузка...</Text>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
