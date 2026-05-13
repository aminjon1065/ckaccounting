// ─── Empty state for owners without shops ──────────────────────────────────
//
// Owners now own shops via `shops.owner_id` (assigned by super_admin), not
// via `users.shop_id`. A freshly-created owner has no shops until the
// admin assigns one — every screen would otherwise render an empty list
// with no explanation. This screen replaces the tabs for those owners
// with a clear "ждите назначения" message and a sign-out escape hatch.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Alert, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/ui";
import { reportError } from "@/lib/observability/reporter";
import { useAuth } from "@/store/auth";

export function NoShopsAssignedScreen() {
  const { signOut, user } = useAuth();

  const handleSignOut = () => {
    Alert.alert(
      "Выйти из аккаунта?",
      "Вы вернётесь к экрану входа. Если администратор назначит вам магазин, войдите снова.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Выйти",
          style: "destructive",
          onPress: () => signOut().catch((e) => reportError(e, { tag: "no-shops-screen-sign-out" })),
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      <View className="flex-1 items-center justify-center px-6 gap-4">
        <View className="w-[100px] h-[100px] rounded-[28px] bg-amber-100 dark:bg-amber-900/30 items-center justify-center">
          <MaterialIcons name="store" size={52} color="#f59e0b" />
        </View>

        <Text className="font-heading text-[22px] tracking-tight text-slate-900 dark:text-white text-center">
          Ждём назначения магазина
        </Text>
        <Text className="text-[13.5px] text-slate-500 dark:text-zinc-400 text-center max-w-[300px] leading-[20px]">
          {user?.name ? `${user.name}, ` : ""}администратор ещё не привязал ваш аккаунт ни к одному магазину. Свяжитесь с владельцем — после этого вы увидите данные.
        </Text>

        {user?.email && (
          <View className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl px-3.5 py-3 mt-2 w-full max-w-[320px]">
            <Text className="text-[11px] font-semibold uppercase tracking-[0.4px] text-slate-500 dark:text-zinc-400">
              Ваш аккаунт
            </Text>
            <Text className="text-[14px] font-semibold text-slate-900 dark:text-white mt-0.5" numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        )}

        <Pressable
          onPress={handleSignOut}
          hitSlop={12}
          className="flex-row items-center gap-1.5 mt-3 py-2 px-3 active:opacity-60"
        >
          <MaterialIcons name="logout" size={16} color="#64748b" />
          <Text className="text-[13.5px] font-medium text-slate-600 dark:text-zinc-300">
            Выйти из аккаунта
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
