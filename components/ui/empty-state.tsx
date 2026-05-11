import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { TouchableOpacity, View } from "react-native";

import * as haptics from "@/lib/haptics";
import { Text } from "./text";

interface EmptyStateProps {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  /** Short headline — 2-4 words, e.g. "Пока нет продаж". */
  title: string;
  /** One-line subtitle explaining what the list shows or how to create the
   *  first item. Keep it conversational, not technical. */
  description?: string;
  /** Optional action — renders a primary button under the description.
   *  Skip when the screen already has a visible FAB for the same action. */
  action?: {
    label: string;
    onPress: () => void;
    icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  };
}

/**
 * Empty-list placeholder. Identical visual rhythm across every list screen
 * so the user gets the same "nothing here yet" signal whether they're on
 * sales, debts, expenses or purchases.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const handlePress = React.useCallback(() => {
    if (!action) return;
    haptics.press();
    action.onPress();
  }, [action]);

  return (
    <View className="items-center justify-center px-8 py-20">
      <View className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-zinc-800 items-center justify-center mb-4">
        <MaterialIcons name={icon} size={32} color="#94a3b8" />
      </View>
      <Text variant="h5" className="text-center text-slate-700 dark:text-slate-200">
        {title}
      </Text>
      {description ? (
        <Text variant="muted" className="mt-2 text-center max-w-xs">
          {description}
        </Text>
      ) : null}
      {action ? (
        <TouchableOpacity
          onPress={handlePress}
          className="mt-5 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl active:opacity-80"
        >
          {action.icon ? (
            <MaterialIcons name={action.icon} size={18} color="#fff" />
          ) : null}
          <Text className="text-sm font-semibold text-white">{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
