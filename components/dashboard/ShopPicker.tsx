import * as React from "react";
import { FlatList, Modal, Pressable, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Text } from "@/components/ui";

interface Shop {
  id: number;
  name: string;
}

interface ShopPickerProps {
  shops: Shop[];
  /** `null` = "All shops" aggregate view. */
  activeShopId: number | null;
  onChange: (shopId: number | null) => void;
}

/**
 * Dashboard shop picker for super_admin and multi-shop owners.
 *
 * Visually a card chip (icon + name + count badge + chevron). Tapping opens
 * a bottom-sheet list with all accessible shops plus an aggregate "All shops"
 * row. Selection updates the dashboard scope.
 */
export function ShopPicker({ shops, activeShopId, onChange }: ShopPickerProps) {
  const [open, setOpen] = React.useState(false);
  const active = activeShopId == null ? null : shops.find((s) => s.id === activeShopId) ?? null;

  return (
    <View className="px-5 pb-2">
      <Pressable
        onPress={() => setOpen(true)}
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl px-3.5 py-2.5 flex-row items-center gap-2.5 active:opacity-80"
      >
        <View className="w-6 h-6 rounded-md bg-slate-100 dark:bg-zinc-800 items-center justify-center">
          <MaterialIcons name="store" size={15} color="#475569" />
        </View>
        <Text
          className="flex-1 text-[14px] font-medium text-slate-900 dark:text-white"
          numberOfLines={1}
        >
          {active ? active.name : "Все магазины"}
        </Text>
        {shops.length > 0 && (
          <View className="px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/40">
            <Text className="text-[11px] font-semibold text-primary-600 dark:text-primary-200">
              {shops.length}
            </Text>
          </View>
        )}
        <MaterialIcons name="expand-more" size={20} color="#94a3b8" />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setOpen(false)}
        >
          <Pressable
            className="bg-white dark:bg-zinc-900 rounded-t-3xl pb-8"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 rounded-full bg-slate-300 dark:bg-zinc-600" />
            </View>

            {/* Header */}
            <View className="px-5 pt-1 pb-3 flex-row items-center justify-between">
              <Text className="font-heading text-[17px] tracking-tight text-slate-900 dark:text-white">
                Выберите магазин
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={8}
                className="w-8 h-8 items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800 active:opacity-70"
              >
                <MaterialIcons name="close" size={18} color="#64748b" />
              </Pressable>
            </View>

            <FlatList
              data={[{ id: null as number | null, name: "Все магазины" }, ...shops]}
              keyExtractor={(item) => (item.id == null ? "all" : String(item.id))}
              renderItem={({ item }) => {
                const selected = item.id === activeShopId;
                const isAll = item.id == null;
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item.id);
                      setOpen(false);
                    }}
                    className={`flex-row items-center gap-3 px-5 py-3.5 active:bg-slate-50 dark:active:bg-zinc-800 ${
                      selected ? "bg-primary-50 dark:bg-primary-900/20" : ""
                    }`}
                  >
                    <View
                      className={`w-9 h-9 rounded-xl items-center justify-center ${
                        isAll
                          ? "bg-primary-100 dark:bg-primary-900/40"
                          : "bg-slate-100 dark:bg-zinc-800"
                      }`}
                    >
                      <MaterialIcons
                        name={isAll ? "apps" : "store"}
                        size={18}
                        color={isAll ? "#0a7ea4" : "#475569"}
                      />
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text
                        className={`text-[15px] ${
                          selected
                            ? "font-semibold text-primary-600 dark:text-primary-300"
                            : "font-medium text-slate-900 dark:text-white"
                        }`}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      {isAll && (
                        <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
                          Все доступные магазины
                        </Text>
                      )}
                    </View>
                    {selected && (
                      <MaterialIcons name="check" size={20} color="#0a7ea4" />
                    )}
                  </Pressable>
                );
              }}
              ItemSeparatorComponent={() => (
                <View className="h-px bg-slate-100 dark:bg-zinc-800 mx-5" />
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
