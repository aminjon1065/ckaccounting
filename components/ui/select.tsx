import * as React from "react";
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  View,
  type ViewProps,
} from "react-native";
import { cn } from "@/lib/utils";
import { Label } from "./label";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

export interface SelectOption<T extends string = string> {
  label: string;
  value: T;
  description?: string;
}

interface SelectProps<T extends string = string> extends ViewProps {
  options: SelectOption<T>[];
  value?: T;
  onValueChange?: (value: T) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

function Select<T extends string = string>({
  className,
  options,
  value,
  onValueChange,
  placeholder = "Select an option",
  label,
  error,
  required,
  disabled,
  ...props
}: SelectProps<T>) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View className={cn("gap-1.5", className)} {...props}>
      {label && <Label required={required}>{label}</Label>}

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        className={cn(
          "flex-row items-center justify-between h-12 rounded-xl border px-3",
          "bg-white dark:bg-zinc-900",
          error
            ? "border-destructive"
            : "border-slate-200 dark:border-zinc-700",
          disabled && "opacity-50"
        )}
      >
        <Text
          className={cn(
            "flex-1 text-sm",
            selected
              ? "text-slate-900 dark:text-slate-50"
              : "text-slate-400 dark:text-slate-500"
          )}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <MaterialIcons
          name="keyboard-arrow-down"
          size={20}
          color="#94a3b8"
        />
      </Pressable>

      {error && (
        <Text className="text-xs text-destructive">{error}</Text>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setOpen(false)}
        >
          <Pressable
            className="bg-white dark:bg-zinc-900 rounded-t-3xl pb-8"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 rounded-full bg-slate-300 dark:bg-zinc-600" />
            </View>

            {label && (
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-50 px-5 pt-1 pb-3">
                {label}
              </Text>
            )}

            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    onPress={() => {
                      onValueChange?.(item.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex-row items-center justify-between px-5 py-3.5 active:bg-slate-50 dark:active:bg-zinc-800",
                      isSelected && "bg-primary-50 dark:bg-blue-900/20"
                    )}
                  >
                    <View className="flex-1 gap-0.5">
                      <Text
                        className={cn(
                          "text-sm font-medium",
                          isSelected
                            ? "text-primary-500"
                            : "text-slate-900 dark:text-slate-50"
                        )}
                      >
                        {item.label}
                      </Text>
                      {item.description && (
                        <Text className="text-xs text-slate-500 dark:text-slate-400">
                          {item.description}
                        </Text>
                      )}
                    </View>
                    {isSelected && (
                      <MaterialIcons name="check" size={18} color="#0a7ea4" />
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

export { Select };
export type { SelectProps };
