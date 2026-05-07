import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Text } from "@/components/ui";
import type { OutboxNotDrainedError } from "@/lib/db/schema";

/**
 * Shown at app startup when a destructive schema migration refused to run
 * because the user still has unsynced offline writes in their outbox.
 *
 * The migration runner is wrapped in a transaction, so when the guard
 * throws the partial migration is rolled back and the schema stays at the
 * prior version. The user keeps their data — they just can't enter the
 * app until they come online and let the outbox drain. This screen tells
 * them so and offers a single retry button that re-runs `initDb()`.
 *
 * Design intentionally light on jargon: the user shouldn't need to know
 * what "migration" or "outbox" means. The pending count is the concrete
 * thing they can check ("3 unsent records") so they know the app isn't
 * lying about there being something to send.
 */
export function MigrationBlockedScreen({
  error,
  onRetry,
}: {
  error: OutboxNotDrainedError;
  onRetry: () => void;
}) {
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = React.useCallback(async () => {
    setRetrying(true);
    try {
      await Promise.resolve(onRetry());
    } finally {
      setRetrying(false);
    }
  }, [onRetry]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
      <View className="w-20 h-20 rounded-3xl bg-amber-100 dark:bg-amber-900/30 items-center justify-center mb-6">
        <MaterialIcons name="cloud-upload" size={38} color="#f59e0b" />
      </View>

      <Text variant="h3" className="text-center text-slate-900 dark:text-slate-50">
        Завершите синхронизацию
      </Text>

      <Text variant="muted" className="text-center mt-3 leading-6">
        Перед обновлением нужно отправить{" "}
        <Text className="font-semibold text-slate-900 dark:text-slate-50">
          {error.unsyncedRows}
        </Text>{" "}
        несохранённых записей на сервер.
        {"\n\n"}
        Подключитесь к интернету, дождитесь окончания синхронизации, затем
        нажмите «Попробовать снова».
      </Text>

      <Button
        className="mt-8 w-full"
        size="lg"
        onPress={handleRetry}
        loading={retrying}
        disabled={retrying}
      >
        Попробовать снова
      </Button>
    </SafeAreaView>
  );
}
