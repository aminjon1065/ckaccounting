import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { TouchableOpacity } from "react-native";

import * as haptics from "@/lib/haptics";

interface FABProps {
  onPress: () => void;
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  /** Optional className override; defaults to the standard primary FAB. */
  className?: string;
}

/**
 * Floating Action Button. Wraps the styling that used to be copy-pasted at
 * the bottom of every list screen and routes the press through a medium
 * haptic so creating things feels deliberate on iOS / Android.
 */
export function FAB({ onPress, icon = "add", className }: FABProps) {
  const handlePress = React.useCallback(() => {
    haptics.press();
    onPress();
  }, [onPress]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      className={
        className ??
        "absolute bottom-8 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg active:opacity-80"
      }
      style={{ elevation: 6 }}
    >
      <MaterialIcons name={icon} size={28} color="#fff" />
    </TouchableOpacity>
  );
}
