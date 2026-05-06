import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Alert, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { Badge, Text } from "@/components/ui";
import { resolveBackendAssetUrl, type Product } from "@/lib/api";

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function stockColor(product: Product) {
  if (product.stock_quantity === 0) {
    return "text-red-500";
  }

  if (product.low_stock_alert != null && product.stock_quantity <= product.low_stock_alert) {
    return "text-amber-500";
  }

  return "text-green-600";
}

function pricingLabel(product: Product) {
  if (product.pricing_mode === "markup") {
    return `Наценка ${product.markup_percent ?? 0}%`;
  }

  if (product.pricing_mode === "manual") {
    return "Ручная";
  }

  return "Фикс.";
}

interface ProductCardProps {
  item: Product;
  onViewDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  token?: string | null;
}

function ProductCardImpl({
  item,
  onViewDetail,
  onEdit,
  onDelete,
  canEdit,
  token,
}: ProductCardProps) {
  const isLow =
    item.low_stock_alert != null && item.stock_quantity <= item.low_stock_alert;
  const isOut = item.stock_quantity === 0;
  const [imageFailed, setImageFailed] = React.useState(false);
  const imageUri = resolveBackendAssetUrl(item.photo_url ?? item.image_url ?? null);

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  return (
    <TouchableOpacity
      onPress={onViewDetail}
      onLongPress={
        canEdit
          ? () =>
              Alert.alert(item.name, "Выберите действие", [
                { text: "Изменить", onPress: onEdit },
                { text: "Удалить", style: "destructive", onPress: onDelete },
                { text: "Отмена", style: "cancel" },
              ])
          : undefined
      }
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 shadow-sm border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-center gap-3 mb-2">
        {imageUri && !imageFailed ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: 52, height: 52, borderRadius: 10 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View className="rounded-xl bg-slate-100 dark:bg-zinc-800 items-center justify-center" style={{ width: 52, height: 52 }}>
            <MaterialIcons name="inventory-2" size={22} color="#94a3b8" />
          </View>
        )}

        <View className="flex-1">
          <View className="flex-row items-start justify-between">
            <Text className="text-base font-semibold text-slate-900 dark:text-slate-50 flex-1 mr-2">
              {item.name}
            </Text>
            {isOut ? (
              <Badge variant="destructive">Нет в наличии</Badge>
            ) : isLow ? (
              <Badge variant="warning">Мало</Badge>
            ) : null}
          </View>
          <Text variant="small">
            {[item.code, item.unit].filter(Boolean).join(" · ") || "—"}
          </Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {pricingLabel(item)}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-4">
        <View>
          <Text variant="small">Закупка</Text>
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {fmt(item.cost_price)}
          </Text>
        </View>
        <View>
          <Text variant="small">Продажа</Text>
          <Text className="text-sm font-semibold text-primary-500">
            {fmt(item.sale_price)}
          </Text>
          {item.bulk_price != null && item.bulk_threshold != null && (
            <Text className="text-xs text-primary-600/80 mt-0.5">
              Опт: {fmt(item.bulk_price)} (от {item.bulk_threshold})
            </Text>
          )}
        </View>
        <View className="flex-1 items-end">
          <Text variant="small">Остаток</Text>
          <Text className={`text-sm font-semibold ${stockColor(item)}`}>
            {item.stock_quantity} {item.unit ?? ""}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Memoized so a 100-item FlatList doesn't re-render every card on each scroll
 * tick or parent state change. Callbacks are intentionally excluded from the
 * comparator — parents wrap them in useCallback or, more often, the visual
 * output doesn't depend on callback identity.
 */
export const ProductCard = React.memo(ProductCardImpl, (prev, next) => {
  if (prev.canEdit !== next.canEdit) return false;
  if (prev.token !== next.token) return false;
  const a = prev.item;
  const b = next.item;
  return (
    a.id === b.id
    && a.name === b.name
    && a.code === b.code
    && a.unit === b.unit
    && a.cost_price === b.cost_price
    && a.sale_price === b.sale_price
    && a.stock_quantity === b.stock_quantity
    && a.low_stock_alert === b.low_stock_alert
    && a.pricing_mode === b.pricing_mode
    && a.markup_percent === b.markup_percent
    && a.bulk_price === b.bulk_price
    && a.bulk_threshold === b.bulk_threshold
    && (a.photo_url ?? a.image_url) === (b.photo_url ?? b.image_url)
  );
});
