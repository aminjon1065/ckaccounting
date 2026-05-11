import * as React from "react";
import { TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Input, Text } from "@/components/ui";
import { fmt, PRICE_MODE_LABELS } from "./helpers";
import type { CartItem, PriceMode } from "./types";

/**
 * Memoized cart row.
 *
 * The parent's `setCart` updates produce new array references, but rows
 * whose `CartItem` reference didn't change pass through unchanged because
 * the parent uses functional `prev.map` updates that preserve identity for
 * untouched entries. Combined with stable `useCallback` handler refs, this
 * means a keystroke in one row's quantity input only re-renders that row
 * — not all 30. The default React.memo shallow compare is enough.
 */
export const CartRow = React.memo(function CartRow({
  item,
  canEditPrice,
  onRemove,
  onPriceModeChange,
  onQuantityChange,
  onQuantityBlur,
  onQuantityAdjust,
  onMarkupChange,
  onPriceChange,
}: {
  item: CartItem;
  canEditPrice: boolean;
  onRemove: (productId: string) => void;
  onPriceModeChange: (productId: string, mode: PriceMode) => void;
  onQuantityChange: (productId: string, value: string) => void;
  onQuantityBlur: (productId: string) => void;
  /** ±1 stepper invoked by the round +/− buttons next to the quantity
   *  input. Parent handles stock cap + remove-on-zero. */
  onQuantityAdjust: (productId: string, delta: number) => void;
  onMarkupChange: (productId: string, value: string) => void;
  onPriceChange: (productId: string, value: string) => void;
}) {
  const productId = item.product.id;

  return (
    <View className="p-3 border-b border-slate-200 dark:border-zinc-700 last:border-0">
      <View className="flex-row items-center justify-between mb-1.5">
        <Text className="text-sm font-medium text-slate-900 dark:text-slate-50 flex-1 mr-2">
          {item.product.name}
        </Text>
        <TouchableOpacity onPress={() => onRemove(productId)} hitSlop={8}>
          <MaterialIcons name="close" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      {/* Price mode toggle */}
      <View className="flex-row bg-slate-200 dark:bg-zinc-700 rounded-lg p-0.5 mb-2">
        {(["fixed", "manual", "markup"] as const).map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => canEditPrice && onPriceModeChange(productId, m)}
            disabled={!canEditPrice}
            className={`flex-1 py-1.5 rounded-md items-center ${
              item.priceMode === m ? "bg-white dark:bg-zinc-900" : ""
            } ${!canEditPrice ? "opacity-50" : ""}`}
          >
            <Text
              className={`text-xs font-medium ${
                item.priceMode === m
                  ? "text-primary-500"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            >
              {PRICE_MODE_LABELS[m]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View className="flex-row items-center gap-3">
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={() => onQuantityAdjust(productId, -1)}
            hitSlop={6}
            className="w-7 h-7 rounded-full bg-slate-200 dark:bg-zinc-700 items-center justify-center active:opacity-70"
          >
            <MaterialIcons name="remove" size={14} color="#64748b" />
          </TouchableOpacity>
          <View className="w-16">
            <Input
              value={item.quantityInput ?? String(item.quantity)}
              onChangeText={(v) => onQuantityChange(productId, v)}
              onBlur={() => onQuantityBlur(productId)}
              keyboardType="numeric"
              selectTextOnFocus
              placeholder="Кол-во"
              className="py-1 text-xs text-center"
            />
          </View>
          <TouchableOpacity
            onPress={() => onQuantityAdjust(productId, 1)}
            hitSlop={6}
            className="w-7 h-7 rounded-full bg-slate-200 dark:bg-zinc-700 items-center justify-center active:opacity-70"
          >
            <MaterialIcons name="add" size={14} color="#64748b" />
          </TouchableOpacity>
        </View>
        {item.priceMode === "markup" ? (
          <View className="flex-1">
            <Input
              value={item.markupPercent}
              onChangeText={(v) => onMarkupChange(productId, v)}
              keyboardType="numeric"
              placeholder="Наценка %"
              className="py-1 text-xs"
            />
          </View>
        ) : (
          <View className="flex-1">
            <Input
              value={String(item.price)}
              onChangeText={(v) => onPriceChange(productId, v)}
              keyboardType="numeric"
              placeholder="Цена"
              className="py-1 text-xs"
              editable={item.priceMode === "manual" && canEditPrice}
            />
          </View>
        )}
        <Text className="text-sm font-semibold text-primary-500 w-20 text-right">
          {fmt(item.price * item.quantity)}
        </Text>
      </View>
    </View>
  );
});
