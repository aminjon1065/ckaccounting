import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Alert, FlatList, RefreshControl, Share, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card, CardContent, Text } from "@/components/ui";
import { archiveSyncAction, archiveSyncActions, getDb } from "@/lib/db";
import { useSync } from "@/lib/sync/SyncContext";
import type { SyncAction } from "@/lib/db";
import { SaleRecoveryModal } from "@/components/sales/SaleRecoveryModal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const diffMins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diffMins < 1) return "только что";
  if (diffMins < 60) return `${diffMins} мин. назад`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} ч. назад`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} дн. назад`;
  return d.toLocaleDateString("ru-RU");
}

const METHOD_COLOR: Record<string, string> = {
  POST: "#0a7ea4",
  PATCH: "#8b5cf6",
  PUT: "#f59e0b",
  DELETE: "#ef4444",
};

function getMethodColor(method: string): string {
  return METHOD_COLOR[method] ?? "#64748b";
}

function getPathLabel(path: string): string {
  if (path.includes("/sales")) return "Продажа";
  if (path.includes("/expenses")) return "Расход";
  if (path.includes("/purchases")) return "Закупка";
  if (path.includes("/products")) return "Товар";
  if (path.includes("/debts")) return "Долг";
  if (path.includes("/shops")) return "Магазин";
  return path;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SyncErrorsScreen() {
  const { failedActions, triggerSync, refreshPendingActions } = useSync();
  const [refreshing, setRefreshing] = React.useState(false);
  const [recoveryAction, setRecoveryAction] = React.useState<SyncAction | null>(null);

  async function handleRetry(action: SyncAction): Promise<void> {
    await getDb().runAsync(
      "UPDATE sync_queue SET status = 'pending', retries = 0, batch_id = NULL WHERE id = ?",
      [action.id]
    );
    await refreshPendingActions();
    triggerSync().catch(console.error);
  }

  function handleRetryWithConfirm(action: SyncAction): void {
    Alert.alert(
      "Восстановить действие?",
      "Это действие было помечено как мёртвое после нескольких неудачных попыток. Попытка снова может снова завершиться ошибкой.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Восстановить",
          onPress: async () => {
            await handleRetry(action);
          },
        },
      ]
    );
  }

  function handleDiscard(action: SyncAction): void {
    Alert.alert(
      "Удалить действие?",
      "Это навсегда удалит данную запись из очереди синхронизации. Локальные данные сохранятся.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            await archiveSyncAction(action.id);
            await refreshPendingActions();
          },
        },
      ]
    );
  }

  function handleDiscardAll(): void {
    if (failedActions.length === 0) return;
    Alert.alert(
      "Удалить все ошибки?",
      `Будет удалено ${failedActions.length} записей из очереди. Локальные данные сохранятся.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить все",
          style: "destructive",
          onPress: async () => {
            await archiveSyncActions("'failed', 'dead'");
            await refreshPendingActions();
          },
        },
      ]
    );
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    try {
      await refreshPendingActions();
      await triggerSync();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleExport(): Promise<void> {
    if (failedActions.length === 0) return;
    const lines: string[] = [
      `Ошибки синхронизации — ${new Date().toLocaleString("ru-RU")}`,
      `${failedActions.length} действий с ошибками\n`,
    ];
    for (const action of failedActions) {
      lines.push(
        `[${action.status?.toUpperCase() ?? "UNKNOWN"}] ${action.method} ${action.path}`,
        `Создано: ${new Date(action.created_at).toLocaleString("ru-RU")}`,
        `Попыток: ${action.retries ?? 0}`,
        action.last_error ? `Ошибка: ${action.last_error}` : "",
        action.payload ? `Payload: ${action.payload}` : "",
        "---"
      );
    }
    try {
      await Share.share({
        message: lines.join("\n"),
        title: "Ошибки синхронизации",
      });
    } catch {}
  }

  function renderItem({ item }: { item: SyncAction }) {
    const methodColor = getMethodColor(item.method);
    const isDead = item.status === "dead";

    return (
      <Card className="mx-4 mb-3">
        <CardContent className="p-4 gap-3">
          {/* Header row */}
          <View className="flex-row items-center gap-2">
            <View
              className="px-2 py-1 rounded"
              style={{ backgroundColor: methodColor + "22" }}
            >
              <Text className="text-xs font-bold" style={{ color: methodColor }}>
                {item.method}
              </Text>
            </View>
            <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50 flex-1">
              {getPathLabel(item.path)}
            </Text>
            {isDead && (
              <View className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/30">
                <Text className="text-xs font-medium text-red-600 dark:text-red-400">
                  Мёртвый
                </Text>
              </View>
            )}
            <Text variant="small" className="text-slate-400">
              {formatDate(item.created_at)}
            </Text>
          </View>

          {/* Path */}
          <View className="bg-slate-100 dark:bg-zinc-800 rounded-lg px-3 py-2">
            <Text className="text-xs font-mono text-slate-500 dark:text-slate-400" numberOfLines={1}>
              {item.path}
            </Text>
          </View>

          {/* Error message */}
          {item.last_error ? (
            <View className="bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              <Text className="text-xs text-red-600 dark:text-red-400" numberOfLines={3}>
                {item.last_error}
              </Text>
            </View>
          ) : null}

          {/* Retry count */}
          <Text variant="small" className="text-slate-400">
            Попыток: {item.retries ?? 0}
          </Text>

          {/* Actions */}
          <View className="flex-row gap-2 pt-1">
            {isDead && item.method === "POST" && item.path === "/sales" ? (
              <TouchableOpacity
                onPress={() => setRecoveryAction(item)}
                className="flex-1 flex-row items-center justify-center gap-1.5 py-2 bg-amber-50 dark:bg-amber-900/30 rounded-lg"
              >
                <MaterialIcons name="edit" size={16} color="#d97706" />
                <Text className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  Исправить
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => isDead ? handleRetryWithConfirm(item) : handleRetry(item)}
                className="flex-1 flex-row items-center justify-center gap-1.5 py-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg"
              >
                <MaterialIcons name="refresh" size={16} color="#0a7ea4" />
                <Text className="text-sm font-medium text-primary-500">
                  {isDead ? "Восстановить" : "Повторить"}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => handleDiscard(item)}
              className="flex-row items-center justify-center gap-1.5 py-2 px-4 border border-slate-200 dark:border-zinc-700 rounded-lg"
            >
              <MaterialIcons name="delete-outline" size={16} color="#ef4444" />
              <Text className="text-sm font-medium text-red-500">Удалить</Text>
            </TouchableOpacity>
          </View>
        </CardContent>
      </Card>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <View className="flex-row items-center justify-between">
          <View>
            <Text variant="h4">Ошибки синхронизации</Text>
            <Text variant="muted" className="mt-0.5">
              {failedActions.length > 0
                ? `${failedActions.length} неудачных`
                : "Нет ошибок"}
            </Text>
          </View>
          {failedActions.length > 0 && (
            <View className="flex-row items-center gap-3">
              <TouchableOpacity onPress={handleExport} hitSlop={8}>
                <Text className="text-sm text-primary-500 font-medium">Экспорт</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDiscardAll} hitSlop={8}>
                <Text className="text-sm text-red-500 font-medium">Очистить все</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {failedActions.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3">
          <MaterialIcons name="cloud-done" size={56} color="#22c55e" />
          <Text variant="muted">Все синхронизировано</Text>
        </View>
      ) : (
        <FlatList
          data={failedActions}
          renderItem={renderItem}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
      )}

      <SaleRecoveryModal action={recoveryAction} onClose={() => setRecoveryAction(null)} />
    </SafeAreaView>
  );
}
