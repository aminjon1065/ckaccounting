import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Text } from "@/components/ui";
import { useAuth } from "@/store/auth";

export default function ShopSuspendedScreen() {
  const { signOut } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
      <View className="w-20 h-20 rounded-3xl bg-red-100 dark:bg-red-900/30 items-center justify-center mb-6">
        <MaterialIcons name="block" size={38} color="#ef4444" />
      </View>

      <Text variant="h3" className="text-center text-slate-900 dark:text-slate-50">
        Магазин приостановлен
      </Text>

      <Text variant="muted" className="text-center mt-3 leading-6">
        Доступ к аккаунту временно ограничен.{"\n"}
        Обратитесь к администратору системы.
      </Text>

      <Button
        className="mt-8 w-full"
        size="lg"
        variant="outline"
        onPress={signOut}
      >
        Выйти из аккаунта
      </Button>
    </SafeAreaView>
  );
}
