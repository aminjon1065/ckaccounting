import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { TouchableOpacity, View } from "react-native";
import { Text } from "@/components/ui";

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

interface SettingsRowProps {
  icon: IconName;
  label: string;
  description?: string;
  onPress?: () => void;
  destructive?: boolean;
  rightText?: string;
}

export function SettingsRow({
  icon,
  label,
  description,
  onPress,
  destructive,
  rightText,
}: SettingsRowProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3.5 active:bg-slate-50 dark:active:bg-zinc-800"
    >
      <View
        className={`w-8 h-8 rounded-lg items-center justify-center ${
          destructive ? "bg-red-100 dark:bg-red-900/30" : "bg-slate-100 dark:bg-zinc-800"
        }`}
      >
        <MaterialIcons
          name={icon}
          size={18}
          color={destructive ? "#ef4444" : "#0a7ea4"}
        />
      </View>
      <View className="flex-1">
        <Text
          className={`text-sm font-medium ${
            destructive
              ? "text-red-500"
              : "text-slate-900 dark:text-slate-50"
          }`}
        >
          {label}
        </Text>
        {description && <Text variant="small">{description}</Text>}
      </View>
      {rightText && (
        <Text variant="small" className="mr-1">{rightText}</Text>
      )}
      {!destructive && (
        <MaterialIcons name="chevron-right" size={18} color="#94a3b8" />
      )}
    </TouchableOpacity>
  );
}
