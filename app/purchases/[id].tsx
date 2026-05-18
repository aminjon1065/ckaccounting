import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { Alert, Pressable, ScrollView, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";

import { Button, Skeleton, Text } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";
import { can } from "@/lib/permissions";
import { fmt } from "@/lib/formatters";
import { EditPurchaseModal } from "@/components/purchases/EditPurchaseModal";
import { useDeletePurchase, usePurchaseDetail } from "@/lib/queries/purchases";
import { useIsOnline } from "@/lib/network/NetworkProvider";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PurchaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const isOnline = useIsOnline();

  const detailQuery = usePurchaseDetail(id, token);
  const deleteMutation = useDeletePurchase(token);

  const purchase = detailQuery.data;
  const loading = detailQuery.isPending;
  const error = detailQuery.error;
  const deleting = deleteMutation.isPending;

  const [editVisible, setEditVisible] = React.useState(false);

  const handleDelete = React.useCallback(() => {
    if (!purchase) return;
    Alert.alert(
      "Удалить закупку?",
      "Товары будут списаны со склада (откат прихода). Действие нельзя отменить.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              const bytes = await Crypto.getRandomBytesAsync(16);
              const idempotencyKey = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
              await deleteMutation.mutateAsync({ id: purchase.id, idempotencyKey });
              showToast({ message: "Закупка удалена", variant: "success" });
              router.back();
            } catch (e: any) {
              if (e instanceof ApiError && e.status === 404) {
                // Already gone — list cache was already cleared by the
                // mutation's onMutate; just navigate away.
                showToast({
                  message: "Закупка уже была удалена.",
                  variant: "error",
                });
                router.back();
              } else if (e instanceof ApiError && e.status === 0) {
                Alert.alert(
                  "Нет соединения",
                  "Не удалось связаться с сервером. Попробуйте, когда восстановится интернет.",
                );
              } else {
                Alert.alert("Ошибка", e?.message ?? "Не удалось удалить закупку.");
              }
            }
          },
        },
      ],
    );
  }, [purchase, router, showToast, deleteMutation]);

  // ── Loading ──
  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        <View className="flex-1 px-4 pt-20 gap-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Hard error: no cached data + a real failure ──
  // 404 means the row is gone — list cache was already pruned on the
  // way in (the user tapped a stale row); show a soft "not found"
  // rather than a panic state.
  const is404 = error instanceof ApiError && error.status === 404;
  if (!purchase) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons
          name={is404 ? "receipt-long" : isOnline ? "error-outline" : "cloud-off"}
          size={48}
          color="#94a3b8"
        />
        <Text variant="h5" className="mt-4 text-center">
          {is404
            ? "Закупка не найдена."
            : isOnline
              ? "Не удалось загрузить закупку."
              : "Нет соединения"}
        </Text>
        {!is404 && (
          <Text variant="muted" className="mt-2 text-center">
            {isOnline
              ? (error as Error)?.message ?? "Попробуйте ещё раз."
              : "Откройте экран, когда восстановится интернет."}
          </Text>
        )}
        <View className="flex-row gap-3 mt-4">
          <Button variant="outline" onPress={() => router.back()}>Назад</Button>
          {!is404 && (
            <Button onPress={() => detailQuery.refetch()}>Повторить</Button>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const canEdit = can(user?.role, "purchases:edit");
  const canDelete = can(user?.role, "purchases:delete");
  const isFetchingInBackground = detailQuery.isFetching && !loading;

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <Text variant="h4" className="flex-1">Закупка №{purchase.id}</Text>
        {isFetchingInBackground && (
          <Text variant="muted" className="text-xs mr-2">Обновляется…</Text>
        )}
        {canDelete && (
          <Pressable
            onPress={handleDelete}
            disabled={deleting}
            hitSlop={8}
            className="w-9 h-9 rounded-full bg-red-50 dark:bg-red-900/20 items-center justify-center active:opacity-70 ml-2"
          >
            <MaterialIcons name="delete-outline" size={18} color="#ef4444" />
          </Pressable>
        )}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary card */}
        <View className="bg-white dark:bg-zinc-900 rounded-2xl p-5 mb-4 border border-slate-100 dark:border-zinc-800">
          <View className="flex-row justify-between mb-3">
            <View>
              <Text variant="muted">Поставщик</Text>
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-50 mt-0.5">
                {purchase.supplier_name || "Неизвестно"}
              </Text>
            </View>
            <View className="items-end">
              <Text variant="muted">Сумма</Text>
              <Text className="text-xl font-bold text-primary-500 mt-0.5">
                {fmt(purchase.total)}
              </Text>
            </View>
          </View>
          <Text variant="small">{fmtDate(purchase.created_at)}</Text>
        </View>

        {/* Items */}
        <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-3">
          Товары ({(purchase.items ?? []).length})
        </Text>

        <View className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 overflow-hidden">
          {(purchase.items ?? []).map((item, index) => (
            <View
              key={item.id}
              className={`p-4 flex-row items-center ${index < (purchase.items ?? []).length - 1
                  ? "border-b border-slate-100 dark:border-zinc-800"
                  : ""
                }`}
            >
              <View className="flex-1">
                <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
                  {item.product_name}
                </Text>
                <Text variant="small">
                  {item.quantity} × {fmt(item.price)}
                </Text>
              </View>
              <Text className="text-sm font-bold text-primary-500">
                {fmt(item.total)}
              </Text>
            </View>
          ))}

          {/* Total row */}
          <View className="p-4 bg-slate-50 dark:bg-zinc-800 flex-row justify-between">
            <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Итого
            </Text>
            <Text className="text-base font-bold text-primary-500">
              {fmt(purchase.total)}
            </Text>
          </View>
        </View>

        {/* Edit CTA — owners only */}
        {canEdit && (
          <Button
            variant="outline"
            className="mt-4"
            onPress={() => setEditVisible(true)}
          >
            <View className="flex-row items-center gap-1.5">
              <MaterialIcons name="edit" size={16} color="#475569" />
              <Text className="text-[14px] font-semibold text-slate-700 dark:text-zinc-200">
                Изменить
              </Text>
            </View>
          </Button>
        )}
      </ScrollView>

      {canEdit && token && (
        <EditPurchaseModal
          visible={editVisible}
          purchase={purchase}
          token={token}
          onClose={() => setEditVisible(false)}
          onSuccess={() => {
            setEditVisible(false);
            // The mutation's onSuccess has already updated the detail
            // cache; no need to manually setPurchase. Background refetch
            // (onSettled) will pick up anything the optimistic patch
            // missed.
          }}
          onMissing={() => {
            setEditVisible(false);
            showToast({
              message: "Закупка была удалена. Возвращаемся к списку.",
              variant: "error",
            });
            router.back();
          }}
        />
      )}
    </SafeAreaView>
  );
}
