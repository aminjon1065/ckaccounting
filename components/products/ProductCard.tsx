import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Alert, Pressable, View } from "react-native";
import { Image } from "expo-image";

import { Badge, Text } from "@/components/ui";
import { resolveBackendAssetUrl, type Product } from "@/lib/api";
import { fmt } from "@/lib/formatters";

function stockColor(product: Product): string {
  if (product.stock_quantity === 0) return "text-red-500";
  if (product.low_stock_alert != null && product.stock_quantity <= product.low_stock_alert) {
    return "text-amber-500";
  }
  return "text-emerald-600 dark:text-emerald-400";
}

function pricingLabel(product: Product): string {
  if (product.pricing_mode === "markup") return `Наценка ${product.markup_percent ?? 0}%`;
  if (product.pricing_mode === "manual") return "Ручная";
  return "Фикс.";
}

interface ProductCardProps {
  item: Product;
  onViewDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}

function ProductCardImpl({ item, onViewDetail, onEdit, onDelete, canEdit }: ProductCardProps) {
  const isOut = item.stock_quantity === 0;
  const isLow =
    !isOut
    && item.low_stock_alert != null
    && item.stock_quantity <= item.low_stock_alert;
  const [imageFailed, setImageFailed] = React.useState(false);
  const imageUri = resolveBackendAssetUrl(item.photo_url ?? item.image_url ?? null);

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  const handleLongPress = canEdit
    ? () =>
        Alert.alert(item.name, "Выберите действие", [
          { text: "Изменить", onPress: onEdit },
          { text: "Удалить", style: "destructive", onPress: onDelete },
          { text: "Отмена", style: "cancel" },
        ])
    : undefined;

  return (
    <Pressable
      onPress={onViewDetail}
      onLongPress={handleLongPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-3.5 mb-2.5 border border-slate-200 dark:border-zinc-800 active:opacity-80"
    >
      {/* Header row */}
      <View className="flex-row items-center gap-3 mb-2.5">
        {imageUri && !imageFailed ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: 50, height: 50, borderRadius: 12 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View
            className="rounded-xl bg-slate-100 dark:bg-zinc-800 items-center justify-center"
            style={{ width: 50, height: 50 }}
          >
            <MaterialIcons name="inventory-2" size={24} color="#94a3b8" />
          </View>
        )}

        <View className="flex-1 min-w-0">
          <View className="flex-row items-start gap-1.5">
            <Text
              className="text-[15px] font-semibold text-slate-900 dark:text-white flex-1"
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {isOut ? (
              <Badge variant="destructive">Нет</Badge>
            ) : isLow ? (
              <Badge variant="warning">Мало</Badge>
            ) : null}
          </View>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {[item.code, item.unit].filter(Boolean).join(" · ") || "—"}
          </Text>
          <Text className="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5">
            {pricingLabel(item)}
          </Text>
        </View>
      </View>

      {/* Bottom stats row */}
      <View
        className="flex-row gap-4 pt-2.5 border-t border-dashed border-slate-200 dark:border-zinc-800"
        style={{ borderStyle: "dashed" }}
      >
        <View>
          <Text className="text-[10.5px] font-semibold uppercase tracking-[0.4px] text-slate-500 dark:text-zinc-400">
            Закупка
          </Text>
          <Text
            className="font-heading text-[14px] tracking-tight text-slate-700 dark:text-zinc-200 mt-0.5"
            style={{ fontVariantLigatures: "none" }}
          >
            {fmt(item.cost_price)}
          </Text>
        </View>
        <View>
          <Text className="text-[10.5px] font-semibold uppercase tracking-[0.4px] text-slate-500 dark:text-zinc-400">
            Продажа
          </Text>
          <Text
            className="font-heading text-[14px] tracking-tight text-primary-500 mt-0.5"
            style={{ fontVariantLigatures: "none" }}
          >
            {fmt(item.sale_price)}
          </Text>
          {item.bulk_price != null && item.bulk_threshold != null && (
            <Text className="text-[10.5px] text-primary-600/80 dark:text-primary-300/80 mt-0.5">
              Опт: {fmt(item.bulk_price)} (от {item.bulk_threshold})
            </Text>
          )}
        </View>
        <View className="flex-1 items-end">
          <Text className="text-[10.5px] font-semibold uppercase tracking-[0.4px] text-slate-500 dark:text-zinc-400">
            Остаток
          </Text>
          <Text
            className={`font-heading text-[15px] tracking-tight mt-0.5 ${stockColor(item)}`}
            style={{ fontVariantLigatures: "none" }}
          >
            {item.stock_quantity} {item.unit ?? ""}
          </Text>
        </View>
      </View>

    </Pressable>
  );
}

export const ProductCard = React.memo(ProductCardImpl, (prev, next) => {
  if (prev.canEdit !== next.canEdit) return false;
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
