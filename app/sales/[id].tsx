import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { Alert, Pressable, ScrollView, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";

import { Badge, Button, Card, CardContent, Skeleton, Text } from "@/components/ui";
import { api, ApiError, type Sale, type SaleItem } from "@/lib/api";
import { generateReceiptHtml } from "@/lib/receipt";
import { deleteLocalSale, getLocalSaleById } from "@/lib/db";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";
import { can } from "@/lib/permissions";
import { ReturnSaleModal } from "@/components/sales/ReturnSaleModal";
import { EditSaleModal } from "@/components/sales/EditSaleModal";
import { fmt } from "@/lib/formatters";
import { useCacheMethods } from "@/lib/cache/CacheProvider";
import { DEFAULT_CURRENCY } from "@/constants/config";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
function fmtTimeShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function shortId(id: string): string {
  // UUIDs aren't human-friendly. Show "#xxxxx" using the last 5 chars.
  const tail = id.replace(/-/g, "").slice(-5).toUpperCase();
  return `#${tail}`;
}

const PAYMENT_ICONS: Record<string, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  cash: "payments",
  card: "credit-card",
  transfer: "swap-horiz",
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
};

// ─── Item row ────────────────────────────────────────────────────────────────

function SaleItemRow({ item, last }: { item: SaleItem; last: boolean }) {
  const displayName = item.service_name ?? item.product_name ?? "—";
  const unitLabel = item.unit ? ` ${item.unit}` : "";
  const returnedQty = item.returned_quantity ?? 0;
  const fullyReturned = returnedQty >= item.quantity;

  return (
    <View
      className={`flex-row items-center gap-3 px-3.5 py-3 ${
        last ? "" : "border-b border-slate-100 dark:border-zinc-800"
      }`}
    >
      <View className="w-9 h-9 rounded-[10px] bg-slate-100 dark:bg-zinc-800 items-center justify-center">
        <MaterialIcons name="inventory-2" size={18} color="#94a3b8" />
      </View>
      <View className="flex-1 min-w-0">
        <Text
          className={`text-[14px] font-medium leading-[18px] ${
            fullyReturned
              ? "text-slate-400 line-through dark:text-zinc-500"
              : "text-slate-900 dark:text-white"
          }`}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
          {item.quantity}{unitLabel} × {fmt(item.price)}
          {returnedQty > 0 ? `  ·  возвращено ${returnedQty}` : ""}
        </Text>
      </View>
      <Text
        className={`font-heading text-[14px] tracking-tight ${
          fullyReturned
            ? "text-slate-400 line-through dark:text-zinc-500"
            : "text-slate-900 dark:text-white"
        }`}
        style={{ fontVariantLigatures: "none" }}
      >
        {fmt(item.total)}
      </Text>
    </View>
  );
}

// ─── Key/value rows ──────────────────────────────────────────────────────────

function TotalRow({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "destructive" | "success" | "warning";
  bold?: boolean;
}) {
  const valueColor =
    tone === "destructive"
      ? "text-red-500"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : tone === "warning"
          ? "text-amber-600 dark:text-amber-400"
          : bold
            ? "text-slate-900 dark:text-white"
            : "text-slate-700 dark:text-zinc-300";
  return (
    <View className="flex-row items-baseline justify-between mb-1.5">
      <Text
        className={`text-[13px] ${
          bold
            ? "font-semibold text-slate-900 dark:text-white"
            : "text-slate-500 dark:text-zinc-400"
        }`}
      >
        {label}
      </Text>
      <Text
        className={`${
          bold ? "font-heading text-[16px] tracking-tight" : "text-[13px] font-medium"
        } ${valueColor}`}
        style={{ fontVariantLigatures: "none" }}
      >
        {value}
      </Text>
    </View>
  );
}

function MetaRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      className={`flex-row items-center justify-between px-3.5 py-3 ${
        last ? "" : "border-b border-slate-100 dark:border-zinc-800"
      }`}
    >
      <Text className="text-[13px] text-slate-500 dark:text-zinc-400">{label}</Text>
      <Text
        className="text-[14px] font-medium text-slate-900 dark:text-white flex-1 text-right ml-3"
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function SaleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();

  const [sale, setSale] = React.useState<Sale | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [returnModalVisible, setReturnModalVisible] = React.useState(false);
  const [editModalVisible, setEditModalVisible] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const { triggerSync } = useCacheMethods();

  const evictGhostAndExit = React.useCallback(
    async (reason: string) => {
      if (!sale) return;
      try {
        await deleteLocalSale(sale.id);
      } catch {
        // Best-effort cleanup
      }
      showToast({ message: reason, variant: "error" });
      router.back();
    },
    [sale, router, showToast],
  );

  const handleDelete = React.useCallback(() => {
    if (!sale || !token) return;
    Alert.alert(
      "Удалить продажу?",
      "Товары будут возвращены на склад. Действие нельзя отменить.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              const bytes = await Crypto.getRandomBytesAsync(16);
              const idempotencyKey = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
              await api.sales.delete(sale.id, token, idempotencyKey);
              showToast({ message: "Продажа удалена", variant: "success" });
              router.back();
            } catch (e: any) {
              if (e instanceof ApiError && e.status === 404) {
                await evictGhostAndExit("Продажа уже была удалена. Локальная копия очищена.");
              } else {
                Alert.alert("Ошибка", e?.message ?? "Не удалось удалить продажу.");
              }
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }, [sale, token, router, showToast, evictGhostAndExit]);

  const handleShareReceipt = React.useCallback(async () => {
    if (!sale) return;
    try {
      const { uri } = await Print.printToFileAsync({ html: generateReceiptHtml(sale) });
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, {
          UTI: ".pdf",
          mimeType: "application/pdf",
          dialogTitle: `Чек ${shortId(sale.id)}`,
        });
      } else {
        Alert.alert("Ошибка", "Функция шэринга файлов недоступна.");
      }
    } catch {
      Alert.alert("Ошибка", "Не удалось сформировать чек.");
    }
  }, [sale]);

  const handlePrintReceipt = React.useCallback(async () => {
    if (!sale) return;
    try {
      await Print.printAsync({ html: generateReceiptHtml(sale) });
    } catch {
      Alert.alert("Ошибка", "Не удалось открыть печать.");
    }
  }, [sale]);

  const handleReturn = React.useCallback(async () => {
    if (!sale || !token) return;
    setReturnModalVisible(true);
  }, [sale, token]);

  const fetchSale = React.useCallback(async () => {
    if (!token || !id) return;
    setError("");
    try {
      const s = await api.sales.get(id, token);
      setSale(s);
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 404) {
        // Server says it's gone — wipe the local mirror too so a future
        // offline view doesn't show a ghost.
        deleteLocalSale(id).catch(() => {});
        setSale(null);
        setError("Продажа была удалена.");
        return;
      }
      if (e instanceof ApiError && e.status === 0) {
        // Offline — try the local mirror as a fallback.
        try {
          const local = await getLocalSaleById(id);
          if (local) {
            setSale(local);
            return;
          }
        } catch {
          // fall through to error message
        }
        setError("Нет сети. Продажа недоступна офлайн.");
      } else {
        setError(e instanceof Error ? e.message : "Не удалось загрузить продажу.");
      }
    }
  }, [id, token]);

  React.useEffect(() => {
    fetchSale().finally(() => setLoading(false));
  }, [fetchSale]);

  // ── Loading ──
  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        <View className="flex-row items-center gap-3 px-4 pt-4 pb-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center"
          >
            <MaterialIcons name="arrow-back" size={20} color="#475569" />
          </Pressable>
          <Skeleton className="h-5 w-40 rounded-lg flex-1" />
        </View>
        <View className="px-4 pt-2 gap-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ──
  if (error || !sale) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="receipt-long" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">
          {error || "Продажа не найдена"}
        </Text>
        <View className="flex-row gap-3 mt-4">
          <Button variant="outline" onPress={() => router.back()}>
            Назад
          </Button>
          {!!error && (
            <Button
              onPress={() => {
                setLoading(true);
                fetchSale().finally(() => setLoading(false));
              }}
            >
              Повторить
            </Button>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const hasDebt = sale.debt > 0;
  const hasDiscount = sale.discount > 0;
  const subtotal = sale.total + sale.discount;
  const returnedTotal = sale.returned_total ?? 0;
  const hasReturn = returnedTotal > 0;
  const payIcon = PAYMENT_ICONS[sale.payment_type] ?? "payments";
  const payLabel = PAYMENT_LABELS[sale.payment_type] ?? sale.payment_type;
  const customer = sale.customer_name?.trim() || "Покупатель";

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
        <View className="flex-1 min-w-0">
          <Text className="font-heading text-[17px] tracking-tight text-slate-900 dark:text-white">
            Продажа
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5" numberOfLines={1}>
            {shortId(sale.id)} · {fmtTimeShort(sale.created_at)}
          </Text>
        </View>
        <Pressable
          onPress={handleShareReceipt}
          hitSlop={8}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="share" size={18} color="#475569" />
        </Pressable>
        {can(user?.role, "sales:delete") && (
          <Pressable
            onPress={handleDelete}
            disabled={deleting}
            hitSlop={8}
            className="w-9 h-9 rounded-full bg-red-50 dark:bg-red-900/20 items-center justify-center active:opacity-70"
          >
            <MaterialIcons name="delete-outline" size={18} color="#ef4444" />
          </Pressable>
        )}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero amount card ── */}
        <Card className="mb-3.5">
          <CardContent className="items-center py-5">
            <Text className="text-[12px] font-medium text-slate-500 dark:text-zinc-400 mb-1.5">
              Сумма продажи
            </Text>
            <View className="flex-row items-baseline gap-1.5">
              <Text
                className={`font-heading text-[34px] leading-[38px] tracking-tight ${
                  sale.is_fully_returned
                    ? "text-slate-400 line-through dark:text-zinc-500"
                    : "text-slate-900 dark:text-white"
                }`}
                style={{ fontVariantLigatures: "none" }}
              >
                {fmt(sale.total)}
              </Text>
              <Text className="text-[14px] font-medium text-slate-500 dark:text-zinc-400">
                {DEFAULT_CURRENCY}
              </Text>
            </View>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-1.5 text-center">
              {customer} · {fmtDate(sale.created_at)} {fmtTimeShort(sale.created_at)}
            </Text>
            <View className="flex-row flex-wrap justify-center gap-2 mt-3">
              <View className="flex-row items-center gap-1.5 bg-primary-100 dark:bg-primary-900/40 px-2.5 py-1 rounded-full">
                <MaterialIcons name={payIcon} size={12} color="#0a7ea4" />
                <Text className="text-[11.5px] font-semibold text-primary-700 dark:text-primary-200">
                  {payLabel}
                </Text>
              </View>
              {hasDebt && <Badge variant="destructive">Долг {fmt(sale.debt)}</Badge>}
              {sale.type === "service" && <Badge variant="secondary">Услуга</Badge>}
              {sale.is_fully_returned && <Badge variant="secondary">Возвращено</Badge>}
              {!sale.is_fully_returned && hasReturn && (
                <Badge variant="secondary">Возврат {fmt(returnedTotal)}</Badge>
              )}
            </View>
          </CardContent>
        </Card>

        {/* ── Items ── */}
        <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mb-2">
          Позиции ({sale.items.length})
        </Text>
        <Card className="p-0 overflow-hidden mb-3.5">
          {sale.items.map((it, idx) => (
            <SaleItemRow key={it.id ?? idx} item={it} last={idx === sale.items.length - 1} />
          ))}
        </Card>

        {/* ── Totals ── */}
        <Card className="mb-3.5">
          <CardContent className="py-3.5">
            <TotalRow label="Подытог" value={`${fmt(subtotal)} ${DEFAULT_CURRENCY}`} />
            {hasDiscount && (
              <TotalRow
                label="Скидка"
                value={`− ${fmt(sale.discount)} ${DEFAULT_CURRENCY}`}
                tone="destructive"
              />
            )}
            {hasReturn && (
              <TotalRow
                label={sale.is_fully_returned ? "Возвращено полностью" : "Возвращено"}
                value={`− ${fmt(returnedTotal)} ${DEFAULT_CURRENCY}`}
                tone="warning"
              />
            )}
            {/* Dashed divider, then Итого */}
            <View
              className="my-2 border-t border-dashed border-slate-200 dark:border-zinc-700"
              style={{ borderStyle: "dashed" }}
            />
            <TotalRow label="Итого" value={`${fmt(sale.total)} ${DEFAULT_CURRENCY}`} bold />
            <TotalRow
              label={hasReturn ? "Оплачено (сейчас)" : "Оплачено"}
              value={`${fmt(sale.paid)} ${DEFAULT_CURRENCY}`}
              tone="success"
            />
            {hasDebt && (
              <TotalRow
                label="Остаток долга"
                value={`${fmt(sale.debt)} ${DEFAULT_CURRENCY}`}
                tone="destructive"
              />
            )}
          </CardContent>
        </Card>

        {/* ── Details ── */}
        <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mb-2">
          Детали
        </Text>
        <Card className="p-0 overflow-hidden mb-3">
          <MetaRow label="Покупатель" value={customer} />
          <MetaRow label="Способ оплаты" value={payLabel} />
          {sale.seller_name ? (
            <MetaRow label="Продавец" value={sale.seller_name} last={!sale.notes} />
          ) : null}
          {!!sale.notes && <MetaRow label="Заметки" value={sale.notes} last />}
        </Card>

        {/* ── Actions ── */}
        <View className="flex-row gap-2 mt-2">
          {can(user?.role, "sales:edit") && (
            <Button
              className="flex-1"
              variant="outline"
              onPress={() => setEditModalVisible(true)}
            >
              <View className="flex-row items-center gap-1.5">
                <MaterialIcons name="edit" size={16} color="#475569" />
                <Text className="text-[14px] font-semibold text-slate-700 dark:text-zinc-200">
                  Изменить
                </Text>
              </View>
            </Button>
          )}
          {can(user?.role, "sales:return") && (
            <Button className="flex-1" variant="outline" onPress={handleReturn}>
              <View className="flex-row items-center gap-1.5">
                <MaterialIcons name="north-east" size={16} color="#475569" />
                <Text className="text-[14px] font-semibold text-slate-700 dark:text-zinc-200">
                  Возврат
                </Text>
              </View>
            </Button>
          )}
        </View>
        <TouchableOpacity
          onPress={handleShareReceipt}
          className="mt-2 py-3 flex-row items-center justify-center gap-2 active:opacity-60"
        >
          <MaterialIcons name="picture-as-pdf" size={18} color="#0a7ea4" />
          <Text className="text-[14px] font-semibold text-primary-500">
            Чек PDF · Поделиться
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handlePrintReceipt}
          className="py-2 flex-row items-center justify-center gap-2 active:opacity-60"
        >
          <MaterialIcons name="print" size={16} color="#94a3b8" />
          <Text className="text-[13px] text-slate-500 dark:text-zinc-400">Печать</Text>
        </TouchableOpacity>
      </ScrollView>

      {sale && (
        <ReturnSaleModal
          visible={returnModalVisible}
          saleId={sale.id}
          items={sale.items}
          token={token!}
          onClose={() => setReturnModalVisible(false)}
          onSuccess={() => {
            setReturnModalVisible(false);
            triggerSync().catch(() => {});
            router.back();
          }}
          onMissing={() => {
            setReturnModalVisible(false);
            evictGhostAndExit("Продажа была удалена. Локальная копия очищена.");
          }}
        />
      )}

      {sale && token && (
        <EditSaleModal
          visible={editModalVisible}
          sale={sale}
          token={token}
          onClose={() => setEditModalVisible(false)}
          onSuccess={(updated) => {
            setSale(updated);
            setEditModalVisible(false);
          }}
          onMissing={() => {
            setEditModalVisible(false);
            evictGhostAndExit("Продажа была удалена. Локальная копия очищена.");
          }}
        />
      )}
    </SafeAreaView>
  );
}
