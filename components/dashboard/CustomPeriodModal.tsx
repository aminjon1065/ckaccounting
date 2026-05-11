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

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value?: string | null) {
  if (!value) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

export function CustomPeriodModal({
  visible,
  onClose,
  onApply,
  initialFrom,
  initialTo,
}: {
  visible: boolean;
  onClose: () => void;
  onApply: (from: string, to: string) => void;
  initialFrom?: string | null;
  initialTo?: string | null;
}) {
  const [from, setFrom] = React.useState(new Date());
  const [to, setTo] = React.useState(new Date());
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!visible) return;
    setFrom(parseLocalDate(initialFrom));
    setTo(parseLocalDate(initialTo));
    setError("");
  }, [visible, initialFrom, initialTo]);

  const handleApply = () => {
    if (from.getTime() > to.getTime()) {
      setError("Дата начала не может быть позже даты окончания.");
      return;
    }

    onApply(
      formatLocalDate(from),
      formatLocalDate(to)
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

          {!!error && (
            <View className="mb-4 rounded-xl bg-red-50 p-3 dark:bg-red-900/20">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}

          {Platform.OS === 'web' ? (
            <View className="gap-5 mb-8">
              <View>
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">От</Text>
                <input 
                  type="date" 
                  value={formatLocalDate(from)}
                  onChange={(e) => {
                    setFrom(parseLocalDate(e.target.value));
                    if (error) setError("");
                  }}
                  style={{ padding: 10, borderRadius: 10, border: '1px solid #e2e8f0', width: '100%', fontSize: 16 }}
                />
              </View>
              <View>
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">До</Text>
                <input 
                  type="date" 
                  value={formatLocalDate(to)}
                  onChange={(e) => {
                    setTo(parseLocalDate(e.target.value));
                    if (error) setError("");
                  }}
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
                    onChange={(_e: unknown, d?: Date) => {
                      if (d) {
                        setFrom(d);
                        if (error) setError("");
                      }
                    }}
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
                    onChange={(_e: unknown, d?: Date) => {
                      if (d) {
                        setTo(d);
                        if (error) setError("");
                      }
                    }}
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
