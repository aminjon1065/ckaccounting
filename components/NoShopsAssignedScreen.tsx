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
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      <View className="flex-1 items-center justify-center px-6 gap-6">
        <View className="w-24 h-24 rounded-full bg-amber-100 dark:bg-amber-900/30 items-center justify-center">
          <MaterialIcons name="storefront" size={44} color="#d97706" />
        </View>

        <View className="items-center gap-3 max-w-sm">
          <Text variant="h4" className="text-center">
            Магазины не назначены
          </Text>
          <Text variant="muted" className="text-center leading-6">
            {user?.name ? `${user.name}, ` : ""}у вашей учётной записи владельца пока нет магазинов. Дождитесь, пока администратор назначит вам хотя бы один магазин — после этого приложение откроется автоматически.
          </Text>
        </View>

        <Pressable
          onPress={handleSignOut}
          hitSlop={12}
          className="mt-4"
        >
          <Text className="text-sm text-slate-500 dark:text-slate-400 underline">
            Выйти из аккаунта
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
