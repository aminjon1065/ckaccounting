import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Badge,
  Button,
  Input,
  Select,
  Skeleton,
  Text,
} from "@/components/ui";
import { api, ApiError, type Shop, type CreateShopPayload } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

// ─── Shop card ────────────────────────────────────────────────────────────────

function ShopCard({
  item,
  onEdit,
  onToggleStatus,
}: {
  item: Shop;
  onEdit: () => void;
  onToggleStatus: () => void;
}) {
  const isActive = item.is_active;

  function handleLongPress() {
    const actions: Array<{ text: string; style?: "destructive" | "cancel" | "default"; onPress?: () => void }> = [
      { text: "Изменить", onPress: onEdit },
      { 
        text: isActive ? "Приостановить" : "Активировать", 
        style: isActive ? "destructive" : "default", 
        onPress: onToggleStatus 
      },
      { text: "Отмена", style: "cancel" }
    ];
    Alert.alert(item.name, "Выберите действие", actions);
  }

  return (
    <TouchableOpacity
      onPress={onEdit}
      onLongPress={handleLongPress}
      activeOpacity={0.7}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800"
    >
      <View className="flex-row items-center gap-3">
        <View className="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center">
          <MaterialIcons name="storefront" size={24} color="#0a7ea4" />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {item.name}
          </Text>
          <View className="flex-row items-center gap-2 mt-1">
            <Badge variant={isActive ? "success" : "destructive"}>
              {isActive ? "Активен" : "Приостановлен"}
            </Badge>
          </View>
        </View>
        <View className="flex-row items-center gap-1">
          <TouchableOpacity
            onPress={onEdit}
            hitSlop={8}
            className="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center"
          >
            <MaterialIcons name="edit" size={16} color="#0a7ea4" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onToggleStatus}
            hitSlop={8}
            className={`w-8 h-8 rounded-full items-center justify-center ${isActive ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}
          >
            <MaterialIcons name={isActive ? "block" : "check-circle-outline"} size={16} color={isActive ? "#ef4444" : "#10b981"} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Create shop modal ────────────────────────────────────────────────────────

function CreateShopModal({
  visible,
  onClose,
  onCreated,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (s: Shop) => void;
  token: string;
}) {
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setName("");
      setError("");
    }
  }, [visible]);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите название магазина."); return; }
    setSubmitting(true);
    try {
      const payload: CreateShopPayload = {
        name: name.trim(),
        is_active: true,
      };
      const created = await api.shops.create(payload, token);
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
          <Text variant="h5" className="flex-1 text-center">Новый магазин</Text>
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
                <Text className="text-sm text-red-600 dark:text-red-400 flex-1">{error}</Text>
              </View>
            )}

            <View className="gap-4">
              <Input
                label="Название магазина"
                required
                placeholder="напр. Главный офис"
                value={name}
                onChangeText={setName}
              />
            </View>

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              Создать магазин
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Edit shop modal ──────────────────────────────────────────────────────────

function EditShopModal({
  visible,
  editingShop,
  onClose,
  onSaved,
  token,
}: {
  visible: boolean;
  editingShop: Shop | null;
  onClose: () => void;
  onSaved: (s: Shop) => void;
  token: string;
}) {
  const [name, setName] = React.useState("");
  const [isActive, setIsActive] = React.useState<"active" | "suspended">("active");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (visible && editingShop) {
      setName(editingShop.name);
      setIsActive(editingShop.is_active ? "active" : "suspended");
      setError("");
    }
  }, [visible, editingShop]);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите название."); return; }
    setSubmitting(true);
    try {
      const payload: Partial<CreateShopPayload> = {
        name: name.trim(),
        is_active: isActive === "active",
      };
      const updated = await api.shops.update(editingShop!.id, payload, token);
      onSaved(updated);
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
          <Text variant="h5" className="flex-1 text-center">Редактировать магазин</Text>
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
                <Text className="text-sm text-red-600 dark:text-red-400 flex-1">{error}</Text>
              </View>
            )}

            <View className="gap-4">
              <Input
                label="Название магазина"
                required
                placeholder="Оставьте пустым, чтобы не менять"
                value={name}
                onChangeText={setName}
              />
              <Select
                label="Статус"
                value={isActive}
                onValueChange={(v) => setIsActive(v as "active" | "suspended")}
                options={[
                  { label: "Активен", value: "active" },
                  { label: "Приостановлен", value: "suspended" },
                ]}
              />
            </View>

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              Сохранить изменения
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ShopsScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();

  const [shops, setShops] = React.useState<Shop[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [createVisible, setCreateVisible] = React.useState(false);
  const [editVisible, setEditVisible] = React.useState(false);
  const [editingShop, setEditingShop] = React.useState<Shop | null>(null);
  const [activeTab, setActiveTab] = React.useState<"all" | "active" | "suspended">("active");

  const isSuperAdmin = user?.role === "super_admin";

  React.useEffect(() => {
    if (!isSuperAdmin || !token) {
      setLoading(false);
      return;
    }
    api.shops
      .list(token)
      .then((res: any) => setShops(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []))
      .catch((e) => console.error("Shops fetch error:", e))
      .finally(() => setLoading(false));
  }, [token, isSuperAdmin]);

  function fetchShops() {
    if (!token) return Promise.resolve();
    return api.shops
      .list(token)
      .then((res: any) => setShops(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []))
      .catch((e) => console.error("Shops fetch error:", e));
  }

  if (!isSuperAdmin) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="lock" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">Нет доступа</Text>
        <Text variant="muted" className="mt-2 text-center">
          Вы не являетесь супер-администратором.
        </Text>
      </SafeAreaView>
    );
  }

  function handleToggleStatus(shop: Shop) {
    const actionWord = shop.is_active ? "приостановить" : "сохранить активность";
    const confirmWord = shop.is_active ? "Приостановить" : "Активировать";
    Alert.alert(
      "Изменение статуса",
      `Вы уверены, что хотите ${actionWord} магазин ${shop.name}?`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: confirmWord,
          style: shop.is_active ? "destructive" : "default",
          onPress: async () => {
            try {
              const updated = await api.shops.update(shop.id, { is_active: !shop.is_active }, token!);
              setShops((prev) => prev.map((s) => s.id === updated.id ? updated : s));
              showToast({ message: `Магазин ${updated.is_active ? "активирован" : "приостановлен"}`, variant: "success" });
            } catch {
              showToast({ message: "Не удалось изменить статус.", variant: "error" });
            }
          },
        },
      ]
    );
  }

  const displayedShops = React.useMemo(() => {
    if (activeTab === "all") return shops;
    if (activeTab === "active") return shops.filter(s => s.is_active);
    return shops.filter(s => !s.is_active);
  }, [shops, activeTab]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text variant="h4">Магазины</Text>
          <Text variant="muted" className="mt-0.5">Центр управления филиалами</Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3].map((i) => (
            <View key={i} className="mb-3">
              <Skeleton className="h-20 rounded-2xl" />
            </View>
          ))}
        </View>
      ) : (
        <>
          {/* Tabs */}
          <View className="flex-row px-5 py-2 gap-2">
            {(["active", "suspended", "all"] as const).map(t => {
              const labels = { active: "Активные", suspended: "Приостановленные", all: "Все" };
              const isTabActive = activeTab === t;
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => setActiveTab(t)}
                  className={`px-4 py-1.5 rounded-full border ${isTabActive ? 'bg-primary-500 border-primary-500' : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700'}`}
                >
                  <Text className={`text-sm font-medium ${isTabActive ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>
                    {labels[t]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          
          <FlatList
            data={displayedShops}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchShops().finally(() => setRefreshing(false));
          }}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <MaterialIcons name="storefront" size={48} color="#94a3b8" />
              <Text variant="muted" className="mt-3 text-center">
                {"Нет магазинов.\nНажмите + для добавления."}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ShopCard
              item={item}
              onEdit={() => { setEditingShop(item); setEditVisible(true); }}
              onToggleStatus={() => handleToggleStatus(item)}
            />
          )}
        />
        </>
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => setCreateVisible(true)}
        className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg active:opacity-80"
        style={{ elevation: 6 }}
      >
        <MaterialIcons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      <CreateShopModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(s) => {
          setShops((prev) => [s, ...prev]);
          showToast({ message: "Магазин создан", variant: "success" });
        }}
        token={token!}
      />

      <EditShopModal
        visible={editVisible}
        editingShop={editingShop}
        onClose={() => setEditVisible(false)}
        onSaved={(updated) => {
          setShops((prev) => prev.map((s) => s.id === updated.id ? updated : s));
          showToast({ message: "Магазин обновлён", variant: "success" });
        }}
        token={token!}
      />
    </SafeAreaView>
  );
}
