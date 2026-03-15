import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Skeleton, Text } from "@/components/ui";
import { api, ApiError, type CreateDebtPayload, type Debt } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// ─── Debt card ────────────────────────────────────────────────────────────────

function DebtCard({ item, onPress }: { item: Debt; onPress: () => void }) {
  const isPositive = item.balance >= 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800 active:opacity-80 flex-row items-center"
    >
      <View className="w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center mr-3">
        <MaterialIcons name="person" size={20} color="#0a7ea4" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
          {item.person_name}
        </Text>
        <Text variant="small">
          Нач. баланс: {fmt(item.opening_balance)}
        </Text>
      </View>
      <View className="items-end">
        <Text
          className={`text-base font-bold ${
            isPositive ? "text-green-600" : "text-red-500"
          }`}
        >
          {isPositive ? "+" : "−"}{fmt(item.balance)}
        </Text>
        <Text variant="small">{isPositive ? "Должны нам" : "Мы должны"}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color="#94a3b8" className="ml-2" />
    </TouchableOpacity>
  );
}

// ─── Create debt modal ────────────────────────────────────────────────────────

function CreateDebtModal({
  visible,
  onClose,
  onCreated,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (d: Debt) => void;
  token: string;
}) {
  const [personName, setPersonName] = React.useState("");
  const [openingBalance, setOpeningBalance] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (visible) { setPersonName(""); setOpeningBalance(""); setError(""); }
  }, [visible]);

  async function handleSubmit() {
    setError("");
    if (!personName.trim()) { setError("Введите имя."); return; }
    setSubmitting(true);
    try {
      const payload: CreateDebtPayload = { person_name: personName.trim() };
      if (openingBalance && !isNaN(Number(openingBalance))) {
        payload.opening_balance = parseFloat(openingBalance);
      }
      const created = await api.debts.create(payload, token);
      onCreated(created);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Что-то пошло не так.");
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
          <Text variant="h5" className="flex-1 text-center">Новый долг</Text>
          <View style={{ width: 22 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
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

            <View className="gap-4">
              <Input
                label="Имя"
                required
                placeholder="напр. Иван Иванов"
                value={personName}
                onChangeText={setPersonName}
                returnKeyType="next"
              />
              <Input
                label="Нач. баланс"
                placeholder="0 (необязательно)"
                hint="Положительный — должны вам, отрицательный — вы должны"
                value={openingBalance}
                onChangeText={setOpeningBalance}
                keyboardType="numeric"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>

            <Button className="mt-6" size="lg" onPress={handleSubmit} loading={submitting} disabled={submitting}>
              Создать
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DebtsScreen() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();

  const [debts, setDebts] = React.useState<Debt[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [createVisible, setCreateVisible] = React.useState(false);
  const [error, setError] = React.useState("");

  async function fetchDebts(reset = false) {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");
    try {
      const res = await api.debts.list(token, { page: pg });
      if (reset) {
        setDebts(res.data);
        setPage(2);
      } else {
        setDebts((prev) => [...prev, ...res.data]);
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e) {
      console.error("Debts fetch error:", e);
      if (reset) setError("Не удалось загрузить долги.");
    }
  }

  React.useEffect(() => {
    fetchDebts(true).finally(() => setLoading(false));
  }, [token]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text variant="h4">Долги</Text>
          <Text variant="muted" className="mt-0.5">Учёт долгов</Text>
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3].map((i) => (
            <View key={i} className="mb-3">
              <Skeleton className="h-16 rounded-2xl" />
            </View>
          ))}
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="cloud-off" size={48} color="#94a3b8" />
          <Text variant="h5" className="mt-4 text-center">Ошибка загрузки</Text>
          <Text variant="muted" className="mt-1 text-center">{error}</Text>
          <TouchableOpacity
            onPress={() => { setLoading(true); fetchDebts(true).finally(() => setLoading(false)); }}
            className="mt-4 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl"
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={debts}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchDebts(true).finally(() => setRefreshing(false));
          }}
          onEndReached={() => {
            if (!hasMore || loadingMore) return;
            setLoadingMore(true);
            fetchDebts(false).finally(() => setLoadingMore(false));
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <MaterialIcons name="people" size={48} color="#94a3b8" />
              <Text variant="muted" className="mt-3 text-center">
                Долгов нет.{"\n"}Нажмите + для добавления.
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color="#0a7ea4" style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={({ item }) => (
            <DebtCard
              item={item}
              onPress={() => router.push(`/debts/${item.id}`)}
            />
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => setCreateVisible(true)}
        className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg active:opacity-80"
        style={{ elevation: 6 }}
      >
        <MaterialIcons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Create modal */}
      <CreateDebtModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(d) => {
          setDebts((prev) => [d, ...prev]);
          showToast({ message: "Долг добавлен", variant: "success" });
        }}
        token={token!}
      />
    </SafeAreaView>
  );
}
