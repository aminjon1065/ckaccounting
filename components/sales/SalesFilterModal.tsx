import * as React from "react";
import { Modal, Pressable, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Button, Text } from "@/components/ui";

export type PaymentFilter = "all" | "cash" | "card" | "transfer";
export type SaleTypeFilter = "all" | "product" | "service";

export interface SalesFilters {
  paymentType: PaymentFilter;
  saleType: SaleTypeFilter;
  debtOnly: boolean;
}

export const DEFAULT_SALES_FILTERS: SalesFilters = {
  paymentType: "all",
  saleType: "all",
  debtOnly: false,
};

export function isDefaultFilters(f: SalesFilters): boolean {
  return f.paymentType === "all" && f.saleType === "all" && !f.debtOnly;
}

export function activeFiltersCount(f: SalesFilters): number {
  let n = 0;
  if (f.paymentType !== "all") n += 1;
  if (f.saleType !== "all") n += 1;
  if (f.debtOnly) n += 1;
  return n;
}

const PAYMENT_OPTIONS: { value: PaymentFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "transfer", label: "Перевод" },
];

const TYPE_OPTIONS: { value: SaleTypeFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "product", label: "Товар" },
  { value: "service", label: "Услуга" },
];

interface Props {
  visible: boolean;
  initial: SalesFilters;
  onClose: () => void;
  onApply: (next: SalesFilters) => void;
}

export function SalesFilterModal({ visible, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = React.useState<SalesFilters>(initial);

  React.useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable
          className="bg-white dark:bg-zinc-900 rounded-t-3xl pb-8"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 rounded-full bg-slate-300 dark:bg-zinc-600" />
          </View>

          <View className="px-5 pt-1 pb-3 flex-row items-center justify-between">
            <Text className="font-heading text-[17px] tracking-tight text-slate-900 dark:text-white">
              Фильтры
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              className="w-8 h-8 items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800 active:opacity-70"
            >
              <MaterialIcons name="close" size={18} color="#64748b" />
            </Pressable>
          </View>

          <View className="px-5 gap-5 pb-3">
            <FilterGroup
              label="Тип оплаты"
              options={PAYMENT_OPTIONS}
              value={draft.paymentType}
              onChange={(value) => setDraft((prev) => ({ ...prev, paymentType: value }))}
            />
            <FilterGroup
              label="Тип продажи"
              options={TYPE_OPTIONS}
              value={draft.saleType}
              onChange={(value) => setDraft((prev) => ({ ...prev, saleType: value }))}
            />

            <Pressable
              onPress={() => setDraft((prev) => ({ ...prev, debtOnly: !prev.debtOnly }))}
              className="flex-row items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/50 active:opacity-70"
            >
              <View className="flex-1 mr-3">
                <Text className="text-[14px] font-medium text-slate-900 dark:text-white">
                  Только с долгом
                </Text>
                <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
                  Скрыть полностью оплаченные продажи
                </Text>
              </View>
              <View
                className={`w-11 h-6 rounded-full justify-center px-0.5 ${
                  draft.debtOnly ? "bg-primary-500" : "bg-slate-300 dark:bg-zinc-700"
                }`}
              >
                <View
                  className={`w-5 h-5 rounded-full bg-white shadow ${
                    draft.debtOnly ? "self-end" : "self-start"
                  }`}
                />
              </View>
            </Pressable>
          </View>

          <View className="px-5 pt-2 flex-row gap-2">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onPress={() => {
                setDraft(DEFAULT_SALES_FILTERS);
                onApply(DEFAULT_SALES_FILTERS);
                onClose();
              }}
            >
              Сбросить
            </Button>
            <Button
              size="lg"
              className="flex-1"
              onPress={() => {
                onApply(draft);
                onClose();
              }}
            >
              Применить
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View>
      <Text className="text-[12px] font-semibold uppercase tracking-[0.6px] text-slate-500 dark:text-zinc-400 mb-2">
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              className={`px-3.5 py-1.5 rounded-full border active:opacity-80 ${
                active
                  ? "bg-primary-500 border-primary-500"
                  : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
              }`}
            >
              <Text
                className={`text-[13px] font-semibold ${
                  active ? "text-white" : "text-slate-700 dark:text-zinc-300"
                }`}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
