import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { Alert, Pressable, ScrollView, TouchableOpacity, View } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge, Card, CardContent, Skeleton, Text } from "@/components/ui";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { ApiError, resolveBackendAssetUrl, type Product } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";
import { useIsOnline } from "@/lib/network/NetworkProvider";
import { useDeleteProduct, useProductDetail } from "@/lib/queries/products";
import { fmt } from "@/lib/formatters";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function pricingLabel(p: Product): string {
  if (p.pricing_mode === "markup") return `Наценка ${p.markup_percent ?? 0}%`;
  if (p.pricing_mode === "manual") return "Ручная";
  return "Фикс.";
}

function stockColorClass(p: Product): string {
  if (p.stock_quantity === 0) return "text-red-500";
  if (p.low_stock_alert != null && p.stock_quantity <= p.low_stock_alert) {
    return "text-amber-500";
  }
  return "text-emerald-600 dark:text-emerald-400";
}

// ─── KPI tile ────────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "primary" | "success" | "neutral";
  sub?: string;
}) {
  const valueClass =
    tone === "primary"
      ? "text-primary-500"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-slate-700 dark:text-zinc-200";
  return (
    <View className="flex-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-3">
      <Text className="text-[10.5px] font-semibold uppercase tracking-[0.4px] text-slate-500 dark:text-zinc-400">
        {label}
      </Text>
      <Text
        className={`font-heading text-[17px] tracking-tight mt-1 ${valueClass}`}
        style={{ fontVariantLigatures: "none" }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
        {sub ?? DEFAULT_CURRENCY}
      </Text>
    </View>
  );
}

// ─── Info row ────────────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
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

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const canViewCost = user?.role !== "seller";
  const canEdit = can(user?.role, "products:edit");
  const canDelete = can(user?.role, "products:delete");
  const router = useRouter();
  const isOnline = useIsOnline();

  const detailQuery = useProductDetail(id, token);
  const deleteMutation = useDeleteProduct(token);

  const product = detailQuery.data ?? null;
  const loading = detailQuery.isPending;
  const error = detailQuery.error;
  const deleting = deleteMutation.isPending;
  const isFetchingInBackground = detailQuery.isFetching && !loading;

  const [imageFailed, setImageFailed] = React.useState(false);
  const [editVisible, setEditVisible] = React.useState(false);
  const imageUri = resolveBackendAssetUrl(product?.photo_url ?? product?.image_url ?? null);
  const imageSource = React.useMemo<ImageSource | undefined>(() => {
    if (!imageUri) return undefined;
    if (/^https?:\/\//i.test(imageUri) && token) {
      return {
        uri: imageUri,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "image/*",
        },
      };
    }
    return { uri: imageUri };
  }, [imageUri, token]);

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  const handleDelete = React.useCallback(() => {
    if (!product) return;
    Alert.alert(
      "Удалить товар",
      `${product.name} будет удалён безвозвратно.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync({
                id: product.id,
                idempotencyKey: `prod-delete-${product.id}`,
              });
              showToast({ message: "Товар удалён", variant: "success" });
              router.back();
            } catch (e: unknown) {
              if (e instanceof ApiError && e.status === 0) {
                showToast({
                  message: "Нет соединения. Проверьте интернет и попробуйте снова.",
                  variant: "error",
                });
              } else if (e instanceof ApiError && e.status === 404) {
                showToast({ message: "Товар уже был удалён.", variant: "success" });
                router.back();
              } else {
                showToast({ message: "Не удалось удалить товар.", variant: "error" });
              }
            }
          },
        },
      ],
    );
  }, [product, deleteMutation, router, showToast]);

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
          <Skeleton className="h-5 w-32 rounded-lg flex-1" />
        </View>
        <View className="px-4 gap-3">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error / not found ──
  const is404 = error instanceof ApiError && error.status === 404;
  if (!product) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons
          name={is404 ? "inventory-2" : isOnline ? "error-outline" : "cloud-off"}
          size={48}
          color="#94a3b8"
        />
        <Text variant="h5" className="mt-4 text-center">
          {is404
            ? "Товар не найден"
            : isOnline
              ? "Не удалось загрузить товар"
              : "Нет соединения"}
        </Text>
        {!is404 && (
          <Text variant="muted" className="mt-1 text-center">
            {isOnline
              ? (error as Error)?.message ?? "Попробуйте ещё раз."
              : "Откройте экран, когда восстановится интернет."}
          </Text>
        )}
        <View className="flex-row gap-3 mt-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800"
          >
            <Text className="text-[14px] font-semibold text-slate-700 dark:text-zinc-300">
              Назад
            </Text>
          </TouchableOpacity>
          {!is404 && (
            <TouchableOpacity
              onPress={() => detailQuery.refetch()}
              className="px-5 py-2.5 rounded-xl bg-primary-500 flex-row items-center gap-2"
            >
              <MaterialIcons name="refresh" size={16} color="#fff" />
              <Text className="text-[14px] font-semibold text-white">Повторить</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const margin =
    product.cost_price > 0
      ? Math.round(((product.sale_price - product.cost_price) / product.cost_price) * 100)
      : 0;
  const marginDelta = product.sale_price - product.cost_price;
  const stockValueCost = product.stock_quantity * product.cost_price;
  const stockValueSale = product.stock_quantity * product.sale_price;

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
        <View className="flex-1 flex-row items-center gap-2">
          <Text className="font-heading text-[17px] tracking-tight text-slate-900 dark:text-white">
            Товар
          </Text>
          {isFetchingInBackground && (
            <Text variant="muted" className="text-xs">Обновляется…</Text>
          )}
        </View>
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/products/movement",
              params: { id: product.id, name: product.name },
            })
          }
          hitSlop={8}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="history" size={18} color="#475569" />
        </Pressable>
        {canEdit && (
          <Pressable
            onPress={() => setEditVisible(true)}
            hitSlop={8}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
          >
            <MaterialIcons name="edit" size={18} color="#475569" />
          </Pressable>
        )}
        {canDelete && (
          <Pressable
            onPress={handleDelete}
            disabled={deleting}
            hitSlop={8}
            className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 items-center justify-center active:opacity-70 disabled:opacity-50"
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
        {/* Hero */}
        <Card className="mb-3.5">
          <CardContent className="items-center py-5">
            {imageSource && !imageFailed ? (
              <Image
                source={imageSource}
                style={{ width: 92, height: 92, borderRadius: 22, marginBottom: 14 }}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={120}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <View
                className="rounded-[22px] bg-slate-100 dark:bg-zinc-800 items-center justify-center mb-3.5"
                style={{ width: 92, height: 92 }}
              >
                <MaterialIcons name="inventory-2" size={44} color="#94a3b8" />
              </View>
            )}
            <Text
              className="font-heading text-[20px] leading-[24px] text-slate-900 dark:text-white tracking-tight text-center"
              numberOfLines={2}
            >
              {product.name}
            </Text>
            <Text className="text-[12.5px] text-slate-500 dark:text-zinc-400 mt-1 text-center">
              {[product.code, product.unit].filter(Boolean).join(" · ") || "—"}
              {" · "}
              {pricingLabel(product)}
            </Text>
            <View className="flex-row items-baseline gap-1.5 mt-3">
              <Text
                className={`font-heading text-[28px] leading-[32px] tracking-tight ${stockColorClass(product)}`}
                style={{ fontVariantLigatures: "none" }}
              >
                {product.stock_quantity}
              </Text>
              <Text className="text-[13px] text-slate-500 dark:text-zinc-400">
                {product.unit ?? "шт"} в остатке
              </Text>
            </View>
            <View className="mt-2">
              {product.stock_quantity === 0 ? (
                <Badge variant="destructive">Нет в наличии</Badge>
              ) : product.low_stock_alert != null
                && product.stock_quantity <= product.low_stock_alert ? (
                <Badge variant="warning">Мало</Badge>
              ) : (
                <Badge variant="success">В наличии</Badge>
              )}
            </View>
          </CardContent>
        </Card>

        {/* KPIs */}
        <View className="flex-row gap-2 mb-3.5">
          {canViewCost && (
            <Kpi label="Закупка" value={fmt(product.cost_price)} />
          )}
          <Kpi label="Продажа" value={fmt(product.sale_price)} tone="primary" />
          {canViewCost && (
            <Kpi
              label="Маржа"
              value={`${margin >= 0 ? "+" : ""}${margin}%`}
              tone="success"
              sub={`${marginDelta >= 0 ? "+" : ""}${fmt(marginDelta)} ${DEFAULT_CURRENCY}`}
            />
          )}
        </View>

        {/* Stock value */}
        {canViewCost && (
          <>
            <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mb-2">
              Оценка склада
            </Text>
            <View className="flex-row gap-2 mb-3.5">
              <View className="flex-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-3">
                <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400">
                  По себестоимости
                </Text>
                <Text
                  className="font-heading text-[16px] tracking-tight text-slate-900 dark:text-white mt-0.5"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {fmt(stockValueCost)} {DEFAULT_CURRENCY}
                </Text>
              </View>
              <View className="flex-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-3">
                <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400">
                  По цене продажи
                </Text>
                <Text
                  className="font-heading text-[16px] tracking-tight text-primary-500 mt-0.5"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {fmt(stockValueSale)} {DEFAULT_CURRENCY}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Details */}
        <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mb-2">
          Детали
        </Text>
        <Card className="p-0 overflow-hidden mb-3.5">
          <InfoRow label="Артикул" value={product.code ?? "—"} />
          <InfoRow label="Единица" value={product.unit ?? "—"} />
          <InfoRow label="Режим цены" value={pricingLabel(product)} />
          <InfoRow
            label="Порог остатка"
            value={
              product.low_stock_alert != null
                ? `${product.low_stock_alert} ${product.unit ?? ""}`
                : "Не задан"
            }
          />
          {product.bulk_price != null && product.bulk_threshold != null && (
            <InfoRow
              label="Опт. цена"
              value={`${fmt(product.bulk_price)} (от ${product.bulk_threshold})`}
            />
          )}
          <InfoRow label="Добавлен" value={fmtDate(product.created_at)} />
          <InfoRow label="Обновлён" value={fmtDate(product.updated_at)} last />
        </Card>

        {/* Movement link */}
        <TouchableOpacity
          onPress={() =>
            router.push({
              pathname: "/products/movement",
              params: { id: product.id, name: product.name },
            })
          }
          className="flex-row items-center justify-center gap-2 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl py-3.5 active:opacity-80"
        >
          <MaterialIcons name="swap-vert" size={20} color="#0a7ea4" />
          <Text className="text-[14px] font-semibold text-primary-600 dark:text-primary-300">
            История движения
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {canEdit && token && (
        <ProductFormModal
          visible={editVisible}
          editing={product}
          token={token}
          onClose={() => setEditVisible(false)}
          onSaved={() => {
            // Mutation already updated the detail + list caches; nothing
            // to do here beyond closing the modal.
            setEditVisible(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}
