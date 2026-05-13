import * as React from "react";
import { Pressable, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";

import { Text } from "@/components/ui";

interface PinKeypadProps {
  value: string;
  onChange: (next: string) => void;
  /** Fires once `value` reaches `length`. The full value is passed so the
   *  caller can avoid the stale-closure race against React's async state flush. */
  onComplete?: (value: string) => void;
  length?: number;
  error?: string | null;
  disabled?: boolean;
  /** When true, the bottom-left key becomes a fingerprint shortcut. */
  showFingerprint?: boolean;
  onFingerprintPress?: () => void;
}

// Letter sub-captions, telephone-keypad style. "1" stays bare on purpose.
const SUBS: Record<string, string> = {
  "2": "ABC",
  "3": "DEF",
  "4": "GHI",
  "5": "JKL",
  "6": "MNO",
  "7": "PQRS",
  "8": "TUV",
  "9": "WXYZ",
};

export function PinKeypad({
  value,
  onChange,
  onComplete,
  length = 4,
  error,
  disabled = false,
  showFingerprint = false,
  onFingerprintPress,
}: PinKeypadProps) {
  const handleKey = React.useCallback(
    (key: string) => {
      if (disabled) return;
      if (key === "back") {
        if (value.length === 0) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onChange(value.slice(0, -1));
        return;
      }
      if (value.length >= length) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const next = value + key;
      onChange(next);
      if (next.length === length) {
        onComplete?.(next);
      }
    },
    [value, length, disabled, onChange, onComplete],
  );

  // 4×3 layout: digits 1-9, then [fingerprint | 0 | backspace]
  const rows: (string | null)[][] = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    [showFingerprint ? "fp" : null, "0", "back"],
  ];

  return (
    <View className="items-center">
      {/* Dots */}
      <View className="flex-row gap-4 mb-5">
        {Array.from({ length }).map((_, i) => {
          const filled = i < value.length;
          const dotClass = error
            ? filled
              ? "bg-rose-500 border-rose-500"
              : "border-rose-400"
            : filled
              ? "bg-primary-500 border-primary-500"
              : "border-slate-300 dark:border-zinc-700";
          return (
            <View
              key={i}
              className={`w-[18px] h-[18px] rounded-full border-2 ${dotClass}`}
            />
          );
        })}
      </View>

      {/* Error slot reserves vertical space so keypad doesn't jump */}
      <View className="h-5 mb-3 items-center justify-center">
        {!!error && (
          <Text className="text-rose-500 text-[13px] font-medium text-center">
            {error}
          </Text>
        )}
      </View>

      {/* Keypad */}
      <View className="gap-2.5 w-full max-w-[320px]">
        {rows.map((row, ri) => (
          <View key={ri} className="flex-row gap-2.5">
            {row.map((key, ki) => {
              if (key === null) {
                return <View key={`empty-${ri}-${ki}`} className="flex-1 h-14" />;
              }
              if (key === "fp") {
                return (
                  <Pressable
                    key="fp"
                    onPress={onFingerprintPress}
                    disabled={disabled || !onFingerprintPress}
                    android_ripple={{ color: "rgba(0,0,0,0.08)", borderless: false, radius: 40 }}
                    className="flex-1 h-14 rounded-2xl items-center justify-center active:opacity-70"
                  >
                    <MaterialIcons name="fingerprint" size={26} color="#475569" />
                  </Pressable>
                );
              }
              if (key === "back") {
                return (
                  <Pressable
                    key="back"
                    onPress={() => handleKey("back")}
                    disabled={disabled}
                    android_ripple={{ color: "rgba(0,0,0,0.08)", borderless: false, radius: 40 }}
                    className="flex-1 h-14 rounded-2xl items-center justify-center active:opacity-70"
                  >
                    <MaterialIcons name="arrow-back" size={22} color="#475569" />
                  </Pressable>
                );
              }
              const sub = SUBS[key];
              return (
                <Pressable
                  key={key}
                  onPress={() => handleKey(key)}
                  disabled={disabled}
                  android_ripple={{ color: "rgba(0,0,0,0.08)", borderless: false, radius: 40 }}
                  className="flex-1 h-14 rounded-2xl items-center justify-center bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 active:bg-slate-50 dark:active:bg-zinc-800"
                  style={({ pressed }) => (pressed ? { transform: [{ scale: 0.97 }] } : null)}
                  accessibilityRole="button"
                  accessibilityLabel={key}
                >
                  <Text className="font-heading text-[24px] leading-[26px] text-slate-900 dark:text-white">
                    {key}
                  </Text>
                  {sub && (
                    <Text className="text-[9px] font-semibold tracking-[1.5px] text-slate-500 dark:text-zinc-400 mt-0.5">
                      {sub}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
