import * as React from "react";
import { Modal, TouchableOpacity, View, Platform } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text, Button } from "@/components/ui";

// Render different pickers per platform
let DateTimePicker: any = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DateTimePicker = require('@react-native-community/datetimepicker').default;
}

export function CustomPeriodModal({
  visible,
  onClose,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = React.useState(new Date());
  const [to, setTo] = React.useState(new Date());

  const handleApply = () => {
    onApply(
      from.toISOString().split("T")[0],
      to.toISOString().split("T")[0]
    );
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-center px-4">
        <View className="bg-white dark:bg-zinc-900 rounded-3xl p-6">
          <View className="flex-row items-center justify-between mb-6">
            <Text variant="h5">Выбрать период</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} className="w-8 h-8 items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800">
              <MaterialIcons name="close" size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {Platform.OS === 'web' ? (
            <View className="gap-5 mb-8">
              <View>
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">От</Text>
                <input 
                  type="date" 
                  value={from.toISOString().split("T")[0]}
                  onChange={(e) => setFrom(new Date(e.target.value))}
                  style={{ padding: 10, borderRadius: 10, border: '1px solid #e2e8f0', width: '100%', fontSize: 16 }}
                />
              </View>
              <View>
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">До</Text>
                <input 
                  type="date" 
                  value={to.toISOString().split("T")[0]}
                  onChange={(e) => setTo(new Date(e.target.value))}
                  style={{ padding: 10, borderRadius: 10, border: '1px solid #e2e8f0', width: '100%', fontSize: 16 }}
                />
              </View>
            </View>
          ) : (
            <View className="gap-5 mb-8">
              <View className="flex-row items-center justify-between p-3 bg-slate-50 dark:bg-zinc-800/50 rounded-xl">
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">От</Text>
                {DateTimePicker && (
                  <DateTimePicker
                    value={from}
                    mode="date"
                    display="default"
                    onChange={(e: any, d?: Date) => d && setFrom(d)}
                  />
                )}
              </View>
              <View className="flex-row items-center justify-between p-3 bg-slate-50 dark:bg-zinc-800/50 rounded-xl">
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">До</Text>
                {DateTimePicker && (
                  <DateTimePicker
                    value={to}
                    mode="date"
                    display="default"
                    onChange={(e: any, d?: Date) => d && setTo(d)}
                  />
                )}
              </View>
            </View>
          )}

          <Button onPress={handleApply} size="lg">Применить</Button>
        </View>
      </View>
    </Modal>
  );
}
