import { useColorScheme as useNativewindColorScheme } from "nativewind";
import * as React from "react";
import * as SecureStore from "expo-secure-store";
import { STORAGE_KEYS } from "@/constants/config";

type StoredColorScheme = "light" | "dark";

function isStoredColorScheme(value: string | null): value is StoredColorScheme {
  return value === "light" || value === "dark";
}

export function useColorScheme() {
  const { colorScheme, setColorScheme } = useNativewindColorScheme();
  const currentColorScheme = colorScheme ?? "system";

  React.useEffect(() => {
    let cancelled = false;

    SecureStore.getItemAsync(STORAGE_KEYS.appTheme)
      .then((stored) => {
        if (!cancelled && isStoredColorScheme(stored)) {
          setColorScheme(stored);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [setColorScheme]);

  const setStoredColorScheme = React.useCallback(
    (next: StoredColorScheme) => {
      setColorScheme(next);
      SecureStore.setItemAsync(STORAGE_KEYS.appTheme, next).catch(() => {});
    },
    [setColorScheme]
  );

  return {
    colorScheme: currentColorScheme,
    setColorScheme: setStoredColorScheme,
    toggleColorScheme: () =>
      setStoredColorScheme(currentColorScheme === "dark" ? "light" : "dark"),
  };
}
