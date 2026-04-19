import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { Alert, ScrollView, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { Badge, Button, Card, CardContent, Separator, Skeleton, Text } from "@/components/ui";
import { api, type Sale, type SaleItem } from "@/lib/api";
import { buildReceiptText, generateReceiptHtml } from "@/lib/receipt";
import { getLocalSaleById } from "@/lib/db";
import { useAuth } from "@/store/auth";

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function SaleItemRow({ item }: { item: SaleItem }) {
  const displayName = item.service_name ?? item.product_name ?? "—";
  const unitLabel = item.unit ? ` · ${item.unit}` : "";

  return (
    <View className="flex-row items-center py-3 border-b border-slate-100 dark:border-zinc-800">
      <View className="flex-1 mr-3">
        <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
          {displayName}
        </Text>
        <Text variant="small">
          {fmt(item.price)}{unitLabel} x {item.quantity}
        </Text>
      </View>
      <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
        {fmt(item.total)}
      </Text>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  color,
}: {
  label: string;
  value: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text
        variant={bold ? undefined : "muted"}
        className={bold ? "text-sm font-semibold text-slate-900 dark:text-slate-50" : undefined}
      >
        {label}
      </Text>
      <Text
        className={`text-sm ${bold ? "font-bold text-slate-900 dark:text-slate-50" : "font-medium text-slate-700 dark:text-slate-300"}`}
        style={color ? { color } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

export default function SaleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const router = useRouter();

  const [sale, setSale] = React.useState<Sale | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [isOffline, setIsOffline] = React.useState(false);

  const handleShareReceipt = React.useCallback(async () => {
    if (!sale) return;
    try {
      const { uri } = await Print.printToFileAsync({ html: generateReceiptHtml(sale) });
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf', dialogTitle: `Чек #${sale.id}` });
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

  const fetchSale = React.useCallback(async () => {
    if (!token || !id) return;
    setError("");

    // Always load local first — works for pending local sales with negative id as local_id
    const local = await getLocalSaleById(id);
    if (local) setSale(local);

    try {
      const s = await api.sales.get(Number(id), token);
      setSale(s);
      setIsOffline(false);
    } catch (e: any) {
      const isOfflineError = e?.status === 0 || !e?.message?.includes("status");
      if (isOfflineError) {
        setIsOffline(true);
        if (!local) setError("Нет сети. Продажа недоступна офлайн.");
      } else {
        if (!local) setError("Не удалось загрузить продажу.");
      }
    }
  }, [id, token]);

  React.useEffect(() => {
    fetchSale().finally(() => setLoading(false));
  }, [fetchSale]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
            <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
          </TouchableOpacity>
          <Skeleton className="h-5 w-40 rounded-lg" />
        </View>
        <View className="flex-1 px-4 pt-4 gap-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !sale) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="receipt-long" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">
          {error || "Продажа не найдена"}
        </Text>
        <View className="flex-row gap-3 mt-4">
          <Button variant="outline" onPress={() => router.back()}>Назад</Button>
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

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text variant="h4">
            {sale.customer_name || "Покупатель"}
          </Text>
          <Text variant="muted" className="mt-0.5">{fmtDate(sale.created_at)}</Text>
        </View>
        <TouchableOpacity
          onPress={handleShareReceipt}
          hitSlop={10}
          className="mr-3 w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center"
        >
          <MaterialIcons name="share" size={18} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-row items-center gap-2">
          {sale.type === "service" && <Badge variant="secondary">Услуга</Badge>}
          {hasDebt && <Badge variant="destructive">Долг</Badge>}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Card className="mb-4">
          <CardContent className="pt-4">
            <View className="flex-row items-center gap-2 mb-3">
              <View className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-blue-900/20 items-center justify-center">
                <MaterialIcons
                  name={PAYMENT_ICONS[sale.payment_type] ?? "payments"}
                  size={20}
                  color="#0a7ea4"
                />
              </View>
              <View>
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {PAYMENT_LABELS[sale.payment_type] ?? sale.payment_type}
                </Text>
                <Text variant="small">Способ оплаты</Text>
              </View>
            </View>

            <Separator className="mb-3" />

            {hasDiscount && (
              <SummaryRow label="Подытог" value={fmt(subtotal)} />
            )}
            {hasDiscount && (
              <SummaryRow label="Скидка" value={`- ${fmt(sale.discount)}`} color="#f59e0b" />
            )}
            <SummaryRow label="Итого" value={fmt(sale.total)} bold />
            <SummaryRow label="Оплачено" value={fmt(sale.paid)} color="#22c55e" />
            {hasDebt && (
              <SummaryRow label="Остаток долга" value={fmt(sale.debt)} color="#ef4444" />
            )}
            {!!sale.notes && (
              <View className="border-t border-slate-100 dark:border-zinc-800 mt-1 pt-2">
                <Text variant="muted" className="text-xs mb-0.5">Заметки</Text>
                <Text className="text-sm text-slate-700 dark:text-slate-300">{sale.notes}</Text>
              </View>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-3 pb-0">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {sale.type === "service" ? "Услуги" : "Товары"}
              </Text>
              <Badge variant="secondary">{sale.items.length} поз.</Badge>
            </View>
            {sale.items.map((item, idx) => (
              <SaleItemRow
                key={item.id ?? idx}
                item={item}
              />
            ))}
            <View className="flex-row items-center justify-between py-3">
              <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                Сумма
              </Text>
              <Text className="text-base font-bold text-primary-500">
                {fmt(sale.total)}
              </Text>
            </View>
          </CardContent>
        </Card>

        <View className="flex-row gap-3 mt-4">
          <Button className="flex-1" variant="outline" onPress={handlePrintReceipt}>
            Печать
          </Button>
          <Button className="flex-1" onPress={handleShareReceipt}>
            Поделиться
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
