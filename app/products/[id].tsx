import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge, Card, CardContent, Skeleton, Text } from "@/components/ui";
import { api, type Product } from "@/lib/api";
import { useAuth } from "@/store/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  });
}

function stockBadge(p: Product) {
  if (p.stock_quantity === 0)
    return <Badge variant="destructive">Нет в наличии</Badge>;
  if (p.low_stock_alert != null && p.stock_quantity <= p.low_stock_alert)
    return <Badge variant="warning">Мало</Badge>;
  return <Badge variant="success">В наличии</Badge>;
}

// ─── Info row ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between py-2.5 border-b border-slate-100 dark:border-zinc-800 last:border-0">
      <Text variant="muted" className="text-sm">{label}</Text>
      <Text className="text-sm font-medium text-slate-900 dark:text-slate-50 text-right flex-1 ml-4">
        {value}
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const router = useRouter();

  const [product, setProduct] = React.useState<Product | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  async function fetchProduct() {
    if (!token || !id) return;
    setError("");
    try {
      const p = await api.products.get(Number(id), token);
      setProduct(p);
    } catch {
      setError("Не удалось загрузить товар.");
    }
  }

  React.useEffect(() => {
    fetchProduct().finally(() => setLoading(false));
  }, [token, id]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1 mr-3">
          {product ? (
            <Text variant="h5" numberOfLines={1}>{product.name}</Text>
          ) : (
            <Text variant="h5">Товар</Text>
          )}
        </View>
        {product && stockBadge(product)}
      </View>

      {/* Content */}
      {loading ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </ScrollView>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="cloud-off" size={48} color="#94a3b8" />
          <Text variant="h5" className="mt-4 text-center">Ошибка загрузки</Text>
          <Text variant="muted" className="mt-1 text-center">{error}</Text>
          <TouchableOpacity
            onPress={() => { setLoading(true); fetchProduct().finally(() => setLoading(false)); }}
            className="mt-4 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl"
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Повторить</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.back()}
            className="mt-3 px-5 py-2.5"
          >
            <Text className="text-sm text-slate-500">Назад</Text>
          </TouchableOpacity>
        </View>
      ) : product ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Product photo */}
          {product.photo_url && (
            <Image
              source={{ uri: product.photo_url }}
              style={{ width: "100%", aspectRatio: 1, borderRadius: 16 }}
              contentFit="cover"
            />
          )}

          {/* Prices card */}
          <Card>
            <CardContent className="pt-3 pb-1">
              <View className="flex-row items-center gap-2 mb-3">
                <View className="w-7 h-7 rounded-lg bg-primary-50 dark:bg-blue-900/20 items-center justify-center">
                  <MaterialIcons name="sell" size={16} color="#0a7ea4" />
                </View>
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Цены
                </Text>
              </View>
              <InfoRow label="Цена закупки" value={fmt(product.cost_price)} />
              <InfoRow label="Цена продажи" value={fmt(product.sale_price)} />
              <InfoRow label="Ед. изм." value={product.unit ?? "—"} />
              <InfoRow label="Артикул" value={product.code ?? "—"} />
            </CardContent>
          </Card>

          {/* Stock card */}
          <Card>
            <CardContent className="pt-3 pb-1">
              <View className="flex-row items-center gap-2 mb-3">
                <View className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-900/20 items-center justify-center">
                  <MaterialIcons name="inventory-2" size={16} color="#d97706" />
                </View>
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Склад
                </Text>
              </View>
              <View className="flex-row items-start justify-between py-2.5 border-b border-slate-100 dark:border-zinc-800">
                <Text variant="muted" className="text-sm">Остаток</Text>
                <View className="flex-row items-center gap-2">
                  <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {product.stock_quantity} {product.unit ?? ""}
                  </Text>
                  {stockBadge(product)}
                </View>
              </View>
              <InfoRow
                label="Порог остатка"
                value={
                  product.low_stock_alert != null
                    ? `${product.low_stock_alert} ${product.unit ?? ""}`
                    : "Не задан"
                }
              />
            </CardContent>
          </Card>

          {/* Info card */}
          <Card>
            <CardContent className="pt-3 pb-1">
              <View className="flex-row items-center gap-2 mb-3">
                <View className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-zinc-800 items-center justify-center">
                  <MaterialIcons name="info-outline" size={16} color="#64748b" />
                </View>
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Информация
                </Text>
              </View>
              <InfoRow label="Дата добавления" value={fmtDate(product.created_at)} />
              <InfoRow label="Дата обновления" value={fmtDate(product.updated_at)} />
            </CardContent>
          </Card>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}
