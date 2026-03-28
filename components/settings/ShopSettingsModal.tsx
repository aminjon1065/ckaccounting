import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Modal, ScrollView, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Text } from "@/components/ui";
import { api, ApiError, type ShopSettings } from "@/lib/api";
import { useToast } from "@/store/toast";

export function ShopSettingsModal({
  visible,
  onClose,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
}) {
  const { showToast } = useToast();
  const [currency, setCurrency] = React.useState("");
  const [taxPercent, setTaxPercent] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!visible) return;
    setError("");
    setLoading(true);
    api.settings
      .get(token)
      .then((s: ShopSettings) => {
        setCurrency(s.default_currency ?? "");
        setTaxPercent(s.tax_percent != null ? String(s.tax_percent) : "0");
      })
      .catch(() => setError("Не удалось загрузить настройки."))
      .finally(() => setLoading(false));
  }, [visible, token]);

  async function handleSave() {
    setError("");
    if (!currency.trim()) { setError("Введите код валюты."); return; }
    const tax = parseFloat(taxPercent);
    if (isNaN(tax) || tax < 0 || tax > 100) {
      setError("Налог должен быть от 0 до 100.");
      return;
    }
    setSubmitting(true);
    try {
      await api.settings.update(
        { default_currency: currency.trim().toUpperCase(), tax_percent: tax },
        token
      );
      showToast({ message: "Настройки магазина обновлены", variant: "success" });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-white dark:bg-zinc-950">
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">Настройки магазина</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          className="flex-1 px-5"
          contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {!!error && (
            <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
              <MaterialIcons name="error-outline" size={16} color="#ef4444" />
              <Text className="text-sm text-red-600 flex-1">{error}</Text>
            </View>
          )}

          {loading ? (
            <Text variant="muted" className="text-center py-8">Загрузка…</Text>
          ) : (
            <View className="gap-4">
              <Input
                label="Валюта"
                required
                placeholder="напр. SMN"
                value={currency}
                onChangeText={setCurrency}
                autoCapitalize="characters"
                hint="Код ISO (напр. SMN, USD, EUR)"
              />
              <Input
                label="Налог (%)"
                placeholder="0"
                value={taxPercent}
                onChangeText={setTaxPercent}
                keyboardType="numeric"
                hint="0 — без налога"
              />
            </View>
          )}

          <Button
            className="mt-6"
            size="lg"
            onPress={handleSave}
            loading={submitting}
            disabled={submitting || loading}
          >
            Сохранить
          </Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
