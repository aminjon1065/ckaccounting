import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Skeleton, Text } from "@/components/ui";
import {
  api,
  ApiError,
  type CreateExpensePayload,
  type Expense,
} from "@/lib/api";
import { useAuth } from "@/store/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { month: "short", day: "numeric" });
}

// ─── Expense card ─────────────────────────────────────────────────────────────

function ExpenseCard({
  item,
  onEdit,
  onDelete,
}: {
  item: Expense;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onEdit}
      onLongPress={() =>
        Alert.alert(item.name, "Выберите действие", [
          { text: "Изменить", onPress: onEdit },
          { text: "Удалить", style: "destructive", onPress: onDelete },
          { text: "Отмена", style: "cancel" },
        ])
      }
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {item.name}
          </Text>
          <Text variant="small">
            {item.quantity} × {fmt(item.price)} = {fmt(item.total)}
          </Text>
          {item.note ? (
            <Text variant="small" className="mt-0.5 italic">
              {item.note}
            </Text>
          ) : null}
        </View>
        <View className="items-end">
          <Text className="text-base font-bold text-red-500">
            {fmt(item.total)}
          </Text>
          <Text variant="small">{fmtDate(item.created_at)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Form modal ───────────────────────────────────────────────────────────────

function ExpenseFormModal({
  visible,
  editing,
  onClose,
  onSaved,
  token,
}: {
  visible: boolean;
  editing: Expense | null;
  onClose: () => void;
  onSaved: (e: Expense) => void;
  token: string;
}) {
  const [name, setName] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [price, setPrice] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const qtyRef = React.useRef<RNTextInput>(null);
  const priceRef = React.useRef<RNTextInput>(null);
  const noteRef = React.useRef<RNTextInput>(null);

  React.useEffect(() => {
    if (visible && editing) {
      setName(editing.name);
      setQuantity(String(editing.quantity));
      setPrice(String(editing.price));
      setNote(editing.note ?? "");
    } else if (visible && !editing) {
      setName(""); setQuantity("1"); setPrice(""); setNote("");
    }
    setError("");
  }, [visible, editing]);

  const total =
    (parseFloat(quantity) || 0) * (parseFloat(price) || 0);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите название расхода."); return; }
    if (!quantity || isNaN(Number(quantity)) || Number(quantity) <= 0) {
      setError("Некорректное количество.");
      return;
    }
    if (!price || isNaN(Number(price)) || Number(price) <= 0) {
      setError("Некорректная цена.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreateExpensePayload = {
        name: name.trim(),
        quantity: parseFloat(quantity),
        price: parseFloat(price),
      };
      if (note.trim()) payload.note = note.trim();

      const saved = editing
        ? await api.expenses.update(editing.id, payload, token)
        : await api.expenses.create(payload, token);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Что-то пошло не так."
      );
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
        {/* Header */}
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">
            {editing ? "Изменить расход" : "Добавить расход"}
          </Text>
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
            showsVerticalScrollIndicator={false}
          >
            {!!error && (
              <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
                <MaterialIcons name="error-outline" size={16} color="#ef4444" />
                <Text className="text-sm text-red-600 flex-1">{error}</Text>
              </View>
            )}

            <View className="gap-4">
              <Input
                label="Название расхода"
                required
                placeholder="напр. Канцтовары"
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                onSubmitEditing={() => qtyRef.current?.focus()}
              />

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    ref={qtyRef}
                    label="Количество"
                    required
                    placeholder="1"
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => priceRef.current?.focus()}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    ref={priceRef}
                    label="Цена за ед."
                    required
                    placeholder="0"
                    value={price}
                    onChangeText={setPrice}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => noteRef.current?.focus()}
                  />
                </View>
              </View>

              {/* Total preview */}
              {total > 0 && (
                <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-3 flex-row justify-between items-center">
                  <Text variant="muted">Итого</Text>
                  <Text className="text-base font-bold text-red-500">
                    {fmt(total)}
                  </Text>
                </View>
              )}

              <Input
                ref={noteRef}
                label="Примечание"
                placeholder="Необязательно…"
                value={note}
                onChangeText={setNote}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                multiline
                numberOfLines={3}
              />
            </View>

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              {editing ? "Сохранить" : "Добавить расход"}
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const { token } = useAuth();

  const [expenses, setExpenses] = React.useState<Expense[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [formVisible, setFormVisible] = React.useState(false);
  const [editing, setEditing] = React.useState<Expense | null>(null);

  async function fetchExpenses(reset = false) {
    if (!token) return;
    const pg = reset ? 1 : page;
    try {
      const res = await api.expenses.list(token, { page: pg });
      if (reset) {
        setExpenses(res.data);
        setPage(2);
      } else {
        setExpenses((prev) => [...prev, ...res.data]);
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e) {
      console.error("Expenses fetch error:", e);
    }
  }

  React.useEffect(() => {
    fetchExpenses(true).finally(() => setLoading(false));
  }, [token]);

  function handleDelete(id: number) {
    Alert.alert("Удалить расход", "Расход будет удалён безвозвратно.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await api.expenses.delete(id, token!);
            setExpenses((prev) => prev.filter((e) => e.id !== id));
          } catch {
            Alert.alert("Ошибка", "Не удалось удалить расход.");
          }
        },
      },
    ]);
  }

  function handleSaved(saved: Expense) {
    setExpenses((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <Text variant="h4">Расходы</Text>
        <Text variant="muted" className="mt-0.5">
          Учёт расходов
        </Text>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="mb-3">
              <Skeleton className="h-20 rounded-2xl" />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchExpenses(true).finally(() => setRefreshing(false));
          }}
          onEndReached={() => {
            if (!hasMore || loadingMore) return;
            setLoadingMore(true);
            fetchExpenses(false).finally(() => setLoadingMore(false));
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <MaterialIcons name="account-balance-wallet" size={48} color="#94a3b8" />
              <Text variant="muted" className="mt-3 text-center">
                Расходов нет.{"\n"}Нажмите + для записи.
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color="#0a7ea4" style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={({ item }) => (
            <ExpenseCard
              item={item}
              onEdit={() => {
                setEditing(item);
                setFormVisible(true);
              }}
              onDelete={() => handleDelete(item.id)}
            />
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => {
          setEditing(null);
          setFormVisible(true);
        }}
        className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg active:opacity-80"
        style={{ elevation: 6 }}
      >
        <MaterialIcons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Form modal */}
      <ExpenseFormModal
        visible={formVisible}
        editing={editing}
        onClose={() => setFormVisible(false)}
        onSaved={handleSaved}
        token={token!}
      />
    </SafeAreaView>
  );
}
