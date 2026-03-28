import { useColorScheme as useNativewindColorScheme } from "nativewind";

export function useColorScheme() {
  const { colorScheme, setColorScheme } = useNativewindColorScheme();

  return {
    colorScheme: colorScheme ?? "system",
    setColorScheme,
    toggleColorScheme: () => setColorScheme(colorScheme === "dark" ? "light" : "dark"),
  };
}
