import * as React from "react";
import { TextInput as RNTextInput, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Input, Text } from "@/components/ui";
import { fmt } from "./helpers";
import type { ServiceLineItem } from "./types";

/**
 * Memoized service-item row. Same rationale as CartRow: parent uses
 * functional `prev.map` updates that preserve identity for unchanged
 * service items, and React.memo gates re-renders on prop identity.
 */
export const ServiceItemRow = React.memo(function ServiceItemRow({
  item,
  onPatch,
  onRemove,
  onQuantityChange,
  onQuantityBlur,
}: {
  item: ServiceLineItem;
  onPatch: (id: string, patch: Partial<ServiceLineItem>) => void;
  onRemove: (id: string) => void;
  onQuantityChange: (id: string, value: string) => void;
  onQuantityBlur: (id: string) => void;
}) {
  const id = item.id;

  return (
    <View className="p-3 border-b border-slate-200 dark:border-zinc-700 last:border-0">
      {/* Row 1: name + delete */}
      <View className="flex-row items-center gap-2 mb-2">
        <RNTextInput
          value={item.name}
          onChangeText={(v) => onPatch(id, { name: v })}
          placeholder="Название услуги"
          placeholderTextColor="#94a3b8"
          className="flex-1 text-sm text-slate-900 dark:text-slate-50 bg-white dark:bg-zinc-900 rounded-lg px-3 py-2"
        />
        <TouchableOpacity onPress={() => onRemove(id)} hitSlop={8}>
          <MaterialIcons name="close" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      {/* Row 2: unit + qty + price + total */}
      <View className="flex-row items-center gap-2">
        <RNTextInput
          value={item.unit}
          onChangeText={(v) => onPatch(id, { unit: v })}
          placeholder="Ед."
          placeholderTextColor="#94a3b8"
          className="w-14 text-xs text-slate-900 dark:text-slate-50 bg-white dark:bg-zinc-900 rounded-lg px-2 py-1.5 text-center"
        />
        <View className="w-20">
          <Input
            value={item.quantityInput ?? String(item.quantity)}
            onChangeText={(v) => onQuantityChange(id, v)}
            onBlur={() => onQuantityBlur(id)}
            keyboardType="numeric"
            placeholder="Кол-во"
            className="py-1 text-xs text-center"
          />
        </View>
        <View className="flex-1">
          <Input
            value={item.price}
            onChangeText={(v) => onPatch(id, { price: v })}
            keyboardType="numeric"
            placeholder="Цена"
            className="py-1 text-xs"
          />
        </View>
        <Text className="text-sm font-semibold text-primary-500 w-20 text-right">
          {fmt((parseFloat(item.price) || 0) * item.quantity)}
        </Text>
      </View>
    </View>
  );
});
