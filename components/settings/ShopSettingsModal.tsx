import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Modal, ScrollView, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Select, Text } from "@/components/ui";
import { api, ApiError, type Shop, type ShopSettings } from "@/lib/api";
import { getLocalShops } from "@/lib/db";
import { useToast } from "@/store/toast";

export function ShopSettingsModal({
  visible,
  onClose,
  token,
  isSuperAdmin,
  currentShopId,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  isSuperAdmin: boolean;
  currentShopId?: number | null;
}) {
  const { showToast } = useToast();
  const [shopId, setShopId] = React.useState("");
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [currency, setCurrency] = React.useState("");
  const [taxPercent, setTaxPercent] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!visible) return;
    setError("");
    setCurrency("");
    setTaxPercent("");

    if (isSuperAdmin) {
      setShopId("");
      getLocalShops()
        .then((local) => {
          if (local.length > 0) {
            setShops(local.map((s) => ({ id: s.id, name: s.name, is_active: s.is_active } as Shop)));
          }
        })
        .catch(() => {});

      api.shops
        .list(token)
        .then((res) => {
          setShops(res.data ?? []);
        })
        .catch(() => {});
    } else {
      setShopId(currentShopId ? String(currentShopId) : "");
    }
  }, [visible, token, isSuperAdmin, currentShopId]);

  React.useEffect(() => {
    if (!visible) return;
    const selectedShopId = isSuperAdmin ? Number(shopId) : currentShopId ?? undefined;
    if (isSuperAdmin && !selectedShopId) return;

    setError("");
    setLoading(true);
    api.settings
      .get(token, selectedShopId)
      .then((s: ShopSettings) => {
        setCurrency(s.default_currency ?? "");
        setTaxPercent(s.tax_percent != null ? String(s.tax_percent) : "0");
      })
      .catch(() => setError("Не удалось загрузить настройки."))
      .finally(() => setLoading(false));
  }, [visible, token, isSuperAdmin, currentShopId, shopId]);

  async function handleSave() {
    setError("");
    const selectedShopId = isSuperAdmin ? Number(shopId) : currentShopId ?? undefined;
    if (isSuperAdmin && !selectedShopId) {
      setError("Выберите магазин.");
      return;
    }
    if (!currency.trim()) { setError("Введите код валюты."); return; }
    const tax = parseFloat(taxPercent);
    if (isNaN(tax) || tax < 0 || tax > 100) {
      setError("Налог должен быть от 0 до 100.");
      return;
    }
    setSubmitting(true);
    const payload = { default_currency: currency.trim().toUpperCase(), tax_percent: tax };
    try {
      await api.settings.update(payload, token, selectedShopId);
      showToast({ message: "Настройки магазина обновлены", variant: "success" });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Не удалось сохранить.");
      }
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
        <View className="flex-row items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <TouchableOpacity
            onPress={onClose}
            hitSlop={10}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
          >
            <MaterialIcons name="close" size={20} color="#475569" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="font-heading text-[17px] tracking-tight text-slate-900 dark:text-white">
              Настройки магазина
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Реквизиты, валюта и налог
            </Text>
          </View>
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
              {isSuperAdmin && (
                <Select
                  label="Магазин"
                  required
                  value={shopId}
                  onValueChange={setShopId}
                  options={shops.map((shop) => ({ label: shop.name, value: String(shop.id) }))}
                  placeholder="Выберите магазин"
                />
              )}
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
            disabled={submitting || loading || (isSuperAdmin && !shopId)}
          >
            Сохранить
          </Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
