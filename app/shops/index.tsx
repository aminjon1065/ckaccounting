import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Badge,
  Button,
  FAB,
  Input,
  Select,
  Skeleton,
  Text,
} from "@/components/ui";
import { api, ApiError, type AppUser, type Shop, type CreateShopPayload } from "@/lib/api";
import { insertOrUpdateShops } from "@/lib/db";
import { reportError } from "@/lib/observability/reporter";
import { useShops } from "@/hooks/useShops";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

// ─── Shop card ────────────────────────────────────────────────────────────────

const ShopCard = React.memo(function ShopCard({
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
    const actions: { text: string; style?: "destructive" | "cancel" | "default"; onPress?: () => void }[] = [
      { text: "Изменить", onPress: onEdit },
      {
        text: isActive ? "Приостановить" : "Активировать",
        style: isActive ? "destructive" : "default",
        onPress: onToggleStatus,
      },
      { text: "Отмена", style: "cancel" },
    ];
    Alert.alert(item.name, "Выберите действие", actions);
  }

  return (
    <TouchableOpacity
      onPress={onEdit}
      onLongPress={handleLongPress}
      activeOpacity={0.8}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-3.5 mb-2.5 border border-slate-200 dark:border-zinc-800"
    >
      <View className="flex-row items-center gap-3">
        <View className="w-[42px] h-[42px] rounded-xl bg-primary-100 dark:bg-primary-900/40 items-center justify-center">
          <MaterialIcons name="storefront" size={20} color="#0a7ea4" />
        </View>
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-1.5">
            <Text
              className="text-[15px] font-semibold text-slate-900 dark:text-white flex-shrink"
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <Badge variant={isActive ? "success" : "destructive"}>
              {isActive ? "Активен" : "Пауза"}
            </Badge>
          </View>
          <Text
            className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5"
            numberOfLines={1}
          >
            {item.owner_name ? `Владелец: ${item.owner_name}` : "Без владельца"}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Pressable
            onPress={onEdit}
            hitSlop={8}
            className="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
          >
            <MaterialIcons name="edit" size={16} color="#0a7ea4" />
          </Pressable>
          <Pressable
            onPress={onToggleStatus}
            hitSlop={8}
            className={`w-8 h-8 rounded-full items-center justify-center active:opacity-70 ${
              isActive ? "bg-red-50 dark:bg-red-900/20" : "bg-emerald-50 dark:bg-emerald-900/20"
            }`}
          >
            <MaterialIcons
              name={isActive ? "block" : "check-circle-outline"}
              size={16}
              color={isActive ? "#ef4444" : "#10b981"}
            />
          </Pressable>
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ─── Create shop modal ────────────────────────────────────────────────────────

function CreateShopModal({
  visible,
  onClose,
  onCreated,
  token,
  showToast,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (s: Shop) => void;
  token: string;
  showToast: ReturnType<typeof useToast>["showToast"];
}) {
  const [name, setName] = React.useState("");
  const [ownerId, setOwnerId] = React.useState<string>("");
  const [owners, setOwners] = React.useState<AppUser[]>([]);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setName("");
      setOwnerId("");
      setError("");
      // Load owners for the assignment dropdown. Server-side filter
      // returns only users with role=owner; client-side filter as belt
      // & braces in case the endpoint changes.
      api.users.list(token, { limit: 100 })
        .then((data) => setOwners(data.filter((u) => u.role === "owner")))
        .catch((e) => reportError(e, { tag: "shop-create-owners-load" }));
    }
  }, [visible, token]);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите название магазина."); return; }
    setSubmitting(true);
    const payload: CreateShopPayload & { owner_id?: number } = {
      name: name.trim(),
      is_active: true,
    };
    if (ownerId) payload.owner_id = parseInt(ownerId, 10);
    try {
      const created = await api.shops.create(payload, token);
      onCreated(created);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Что-то пошло не так.");
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
              Новый магазин
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Название и владелец
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView
          behavior="padding"
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
              <Select
                label="Владелец"
                value={ownerId}
                onValueChange={setOwnerId}
                options={[
                  { label: "Без владельца (назначить позже)", value: "" },
                  ...owners.map((o) => ({ label: `${o.name} (${o.email})`, value: String(o.id) })),
                ]}
                placeholder="Не назначен"
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
  onMissing,
  token,
  showToast,
}: {
  visible: boolean;
  editingShop: Shop | null;
  onClose: () => void;
  onSaved: (s: Shop) => void;
  /** Server reported the shop no longer exists — caller should evict it locally. */
  onMissing: (id: number) => void;
  token: string;
  showToast: ReturnType<typeof useToast>["showToast"];
}) {
  const [name, setName] = React.useState("");
  const [isActive, setIsActive] = React.useState<"active" | "suspended">("active");
  const [ownerId, setOwnerId] = React.useState<string>("");
  const [owners, setOwners] = React.useState<AppUser[]>([]);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (visible && editingShop) {
      setName(editingShop.name);
      setIsActive(editingShop.is_active ? "active" : "suspended");
      // Pre-fill from the shop's current owner_id (server returns it on
      // ShopResource). Empty string = "не назначен" in the dropdown.
      const currentOwnerId = (editingShop as Shop & { owner_id?: number | null }).owner_id;
      setOwnerId(currentOwnerId != null ? String(currentOwnerId) : "");
      setError("");
      api.users.list(token, { limit: 100 })
        .then((data) => setOwners(data.filter((u) => u.role === "owner")))
        .catch((e) => reportError(e, { tag: "shop-edit-owners-load" }));
    }
  }, [visible, editingShop, token]);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите название."); return; }
    setSubmitting(true);
    const payload: Partial<CreateShopPayload> & { owner_id?: number | null } = {
      name: name.trim(),
      is_active: isActive === "active",
      // Empty string in the picker = explicit "unassign" — send null to
      // the server so the shop is detached from its current owner.
      owner_id: ownerId ? parseInt(ownerId, 10) : null,
    };
    try {
      const updated = await api.shops.update(editingShop!.id, payload, token);
      onSaved(updated);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else if (e instanceof ApiError && e.status === 404) {
        // Local cache had a ghost (server hard-deleted the shop and the
        // tombstone never reached the delta sync). Evict locally + close.
        onMissing(editingShop!.id);
        showToast({
          message: "Магазин был удалён. Локальная копия очищена.",
          variant: "error",
        });
        onClose();
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Что-то пошло не так.");
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
              {editingShop?.name ?? "Магазин"}
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Статус и владелец
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView
          behavior="padding"
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
              <Select
                label="Владелец"
                value={ownerId}
                onValueChange={setOwnerId}
                options={[
                  { label: "Без владельца", value: "" },
                  ...owners.map((o) => ({ label: `${o.name} (${o.email})`, value: String(o.id) })),
                ]}
                placeholder="Не назначен"
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

  const {
    shops,
    setShops,
    loading,
    refreshing,
    handleRefresh,
    dropLocal,
  } = useShops({ token });

  const [createVisible, setCreateVisible] = React.useState(false);
  const [editVisible, setEditVisible] = React.useState(false);
  const [editingShop, setEditingShop] = React.useState<Shop | null>(null);
  const [activeTab, setActiveTab] = React.useState<"all" | "active" | "suspended">("active");

  const isSuperAdmin = user?.role === "super_admin";

  const displayedShops = React.useMemo(() => {
    // Dedupe by id — optimistic insert + a fast refetch can briefly emit the
    // same shop twice and FlatList crashes on duplicate keys.
    const seen = new Set<number>();
    const unique: Shop[] = [];
    for (const s of shops) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      unique.push(s);
    }
    if (activeTab === "all") return unique;
    if (activeTab === "active") return unique.filter((shop) => shop.is_active);
    return unique.filter((shop) => !shop.is_active);
  }, [activeTab, shops]);

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
            // Optimistic update — instant feedback for a fast toggle. Rolled
            // back on any error (including offline) so the visible state
            // always matches what's actually persisted server-side.
            setShops((prev) => prev.map((s) =>
              s.id === shop.id ? { ...s, is_active: !s.is_active } : s
            ));
            try {
              const updated = await api.shops.update(shop.id, { is_active: !shop.is_active }, token!);
              setShops((prev) => prev.map((s) => s.id === updated.id ? updated : s));
              insertOrUpdateShops([updated]).catch((e) =>
                reportError(e, { tag: "shops-toggle-persist", id: updated.id })
              );
              showToast({ message: `Магазин ${updated.is_active ? "активирован" : "приостановлен"}`, variant: "success" });
            } catch (e) {
              setShops((prev) => prev.map((s) =>
                s.id === shop.id ? { ...s, is_active: shop.is_active } : s
              ));
              if (e instanceof ApiError && e.status === 0) {
                showToast({
                  message: "Нет соединения. Проверьте интернет и попробуйте снова.",
                  variant: "error",
                });
              } else if (e instanceof ApiError && e.status === 404) {
                // Server hard-deleted the shop; ghost survived in local cache.
                // Drop it so the list reflects reality.
                dropLocal(shop.id).catch(() => {});
                showToast({
                  message: "Магазин был удалён. Локальная копия очищена.",
                  variant: "error",
                });
              } else {
                showToast({ message: "Не удалось изменить статус.", variant: "error" });
              }
            }
          },
        },
      ]
    );
  }

  // Summary counts (server-truth — these are the deduped list).
  const allShops = React.useMemo(() => {
    const seen = new Set<number>();
    const unique: Shop[] = [];
    for (const s of shops) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      unique.push(s);
    }
    return unique;
  }, [shops]);
  const counts = React.useMemo(() => {
    let active = 0;
    for (const s of allShops) if (s.is_active) active += 1;
    return { total: allShops.length, active, suspended: allShops.length - active };
  }, [allShops]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center gap-2 px-4 pt-4 pb-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="arrow-back" size={20} color="#475569" />
        </Pressable>
        <View className="flex-1">
          <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white">
            Магазины
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            Управление сетью
          </Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 px-4 pt-2">
          <Skeleton className="h-[64px] rounded-2xl mb-2.5" />
          {[1, 2, 3].map((i) => (
            <View key={i} className="mb-2.5">
              <Skeleton className="h-[72px] rounded-2xl" />
            </View>
          ))}
        </View>
      ) : (
        <>
          {/* Tabs — minimal underline style */}
          <View className="flex-row px-4 border-b border-slate-200 dark:border-zinc-800">
            {([
              { key: "active", label: "Активные", count: counts.active },
              { key: "suspended", label: "Пауза", count: counts.suspended },
              { key: "all", label: "Все", count: counts.total },
            ] as const).map((t) => {
              const isTabActive = activeTab === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setActiveTab(t.key)}
                  className="mr-6 py-2.5 flex-row items-center gap-1.5 active:opacity-60"
                  style={{
                    borderBottomWidth: 2,
                    borderBottomColor: isTabActive ? "#0a7ea4" : "transparent",
                    marginBottom: -1,
                  }}
                >
                  <Text
                    className={`text-[14px] ${
                      isTabActive
                        ? "text-primary-600 dark:text-primary-400 font-semibold"
                        : "text-slate-500 dark:text-zinc-400 font-medium"
                    }`}
                  >
                    {t.label}
                  </Text>
                  {t.count > 0 && (
                    <Text
                      className={`text-[12px] ${
                        isTabActive
                          ? "text-primary-600 dark:text-primary-400 font-semibold"
                          : "text-slate-400 dark:text-zinc-500"
                      }`}
                    >
                      {t.count}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          <FlatList
            data={displayedShops}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 }}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            ListHeaderComponent={
              counts.total > 0 ? (
                <View className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-3.5 mb-3 flex-row">
                  <View className="flex-1">
                    <Text className="text-[10.5px] font-semibold uppercase tracking-[0.5px] text-slate-500 dark:text-zinc-400">
                      Всего
                    </Text>
                    <Text
                      className="font-heading text-[22px] tracking-tight text-slate-900 dark:text-white mt-0.5"
                      style={{ fontVariantLigatures: "none" }}
                    >
                      {counts.total}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-[10.5px] font-semibold uppercase tracking-[0.5px] text-slate-500 dark:text-zinc-400">
                      Активных
                    </Text>
                    <Text
                      className="font-heading text-[22px] tracking-tight text-emerald-600 dark:text-emerald-400 mt-0.5"
                      style={{ fontVariantLigatures: "none" }}
                    >
                      {counts.active}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-[10.5px] font-semibold uppercase tracking-[0.5px] text-slate-500 dark:text-zinc-400">
                      Пауза
                    </Text>
                    <Text
                      className="font-heading text-[22px] tracking-tight text-red-500 mt-0.5"
                      style={{ fontVariantLigatures: "none" }}
                    >
                      {counts.suspended}
                    </Text>
                  </View>
                </View>
              ) : null
            }
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
                onEdit={() => {
                  setEditingShop(item);
                  setEditVisible(true);
                }}
                onToggleStatus={() => handleToggleStatus(item)}
              />
            )}
          />
        </>
      )}

      {/* FAB */}
      <FAB onPress={() => setCreateVisible(true)} />

      <CreateShopModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(s) => {
          setShops((prev) => [s, ...prev]);
          // Persist immediately so re-entering the screen (which reloads
          // from SQLite) doesn't drop this row until the next remote pull.
          insertOrUpdateShops([s]).catch((e) =>
            reportError(e, { tag: "shops-onCreated-persist", id: s.id })
          );
        }}
        token={token!}
        showToast={showToast}
      />

      <EditShopModal
        visible={editVisible}
        editingShop={editingShop}
        onClose={() => setEditVisible(false)}
        onSaved={(updated) => {
          setShops((prev) => prev.map((s) => s.id === updated.id ? updated : s));
          // Mirror the server response into SQLite immediately. Without this
          // the owner_id / owner_name / is_active edit only lives in React
          // state until the next reconcileAndLoad — backing out and re-entering
          // the screen would show stale data.
          insertOrUpdateShops([updated]).catch((e) =>
            reportError(e, { tag: "shops-onSaved-persist", id: updated.id })
          );
        }}
        onMissing={(id) => {
          dropLocal(id).catch(() => {});
        }}
        token={token!}
        showToast={showToast}
      />
    </SafeAreaView>
  );
}
