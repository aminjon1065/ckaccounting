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
  Avatar,
  Badge,
  Button,
  Input,
  Select,
  Skeleton,
  Text,
} from "@/components/ui";
import { api, ApiError, type AppUser, type CreateUserPayload, type Shop } from "@/lib/api";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

// ─── User card ────────────────────────────────────────────────────────────────

function UserCard({
  item,
  currentUserId,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}: {
  item: AppUser;
  currentUserId?: number;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const isSelf = item.id === currentUserId;

  function handleLongPress() {
    const actions: Array<{ text: string; style?: "destructive" | "cancel"; onPress?: () => void }> = [];
    if (canEdit) actions.push({ text: "Изменить", onPress: onEdit });
    if (canDelete) actions.push({ text: "Удалить", style: "destructive", onPress: onDelete });
    actions.push({ text: "Отмена", style: "cancel" });
    Alert.alert(item.name, "Выберите действие", actions);
  }

  return (
    <TouchableOpacity
      onPress={canEdit && !isSelf ? onEdit : undefined}
      onLongPress={(canEdit || canDelete) && !isSelf ? handleLongPress : undefined}
      activeOpacity={canEdit && !isSelf ? 0.7 : 1}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800"
    >
      <View className="flex-row items-center gap-3">
        <Avatar name={item.name} size="default" />
        <View className="flex-1">
          <View className="flex-row items-center gap-2 flex-wrap">
            <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
              {item.name}
            </Text>
            {isSelf && <Badge variant="secondary">Вы</Badge>}
          </View>
          <Text variant="muted">{item.email}</Text>
          <View className="flex-row items-center gap-1.5 mt-0.5">
            <MaterialIcons
              name={item.role === "seller" ? "person" : "admin-panel-settings"}
              size={13}
              color="#0a7ea4"
            />
            <Text className="text-xs font-medium text-primary-500">
              {ROLE_LABELS[item.role]}
            </Text>
          </View>
        </View>
        {!isSelf && (canEdit || canDelete) && (
          <View className="flex-row items-center gap-1">
            {canEdit && (
              <TouchableOpacity
                onPress={onEdit}
                hitSlop={8}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center"
              >
                <MaterialIcons name="edit" size={16} color="#0a7ea4" />
              </TouchableOpacity>
            )}
            {canDelete && (
              <TouchableOpacity
                onPress={onDelete}
                hitSlop={8}
                className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 items-center justify-center"
              >
                <MaterialIcons name="delete-outline" size={16} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Create user modal ────────────────────────────────────────────────────────

function CreateUserModal({
  visible,
  onClose,
  onCreated,
  token,
  isSuperAdmin,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (u: AppUser) => void;
  token: string;
  isSuperAdmin: boolean;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<"owner" | "seller">("seller");
  const [shopId, setShopId] = React.useState<string>("");
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const roleOptions = isSuperAdmin
    ? [
        { label: ROLE_LABELS["owner"], value: "owner" as const },
        { label: ROLE_LABELS["seller"], value: "seller" as const },
      ]
    : [{ label: ROLE_LABELS["seller"], value: "seller" as const }];

  React.useEffect(() => {
    if (visible) {
      setName("");
      setEmail("");
      setPassword("");
      setRole("seller");
      setShopId("");
      setError("");
      if (isSuperAdmin) {
        api.shops.list(token).then((res: any) => setShops(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [])).catch(console.error);
      }
    }
  }, [visible, isSuperAdmin, token]);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите имя."); return; }
    if (!email.trim()) { setError("Введите email."); return; }
    if (!password || password.length < 8) {
      setError("Пароль должен быть не менее 8 символов.");
      return;
    }
    setSubmitting(true);
    if (isSuperAdmin && !shopId) {
      setError("Выберите магазин.");
      setSubmitting(false);
      return;
    }
    try {
      const payload: CreateUserPayload = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
      };
      if (isSuperAdmin && shopId) payload.shop_id = parseInt(shopId, 10);
      const created = await api.users.create(payload, token);
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
          <Text variant="h5" className="flex-1 text-center">Новый сотрудник</Text>
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
                label="Имя"
                required
                placeholder="напр. Иван Иванов"
                value={name}
                onChangeText={setName}
              />
              <Input
                label="Email"
                required
                placeholder="user@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Input
                label="Пароль"
                required
                placeholder="Минимум 8 символов"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              {isSuperAdmin && (
                <>
                  <Select
                    label="Магазин"
                    required
                    value={shopId}
                    onValueChange={setShopId}
                    options={shops.map(s => ({ label: s.name, value: String(s.id) }))}
                    placeholder="Выберите магазин"
                  />
                  <Select
                    label="Роль"
                    value={role}
                    onValueChange={(v) => setRole(v as "owner" | "seller")}
                    options={roleOptions}
                    placeholder="Выберите роль"
                  />
                </>
              )}
            </View>

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              Создать сотрудника
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Edit user modal ──────────────────────────────────────────────────────────

function EditUserModal({
  visible,
  editingUser,
  onClose,
  onSaved,
  token,
  isSuperAdmin,
}: {
  visible: boolean;
  editingUser: AppUser | null;
  onClose: () => void;
  onSaved: (u: AppUser) => void;
  token: string;
  isSuperAdmin: boolean;
}) {
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<"owner" | "seller">("seller");
  const [shopId, setShopId] = React.useState<string>("");
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const roleOptions = isSuperAdmin
    ? [
        { label: ROLE_LABELS["owner"], value: "owner" as const },
        { label: ROLE_LABELS["seller"], value: "seller" as const },
      ]
    : [{ label: ROLE_LABELS["seller"], value: "seller" as const }];

  React.useEffect(() => {
    if (visible && editingUser) {
      setName(editingUser.name);
      setRole(editingUser.role as "owner" | "seller");
      setShopId(editingUser.shop_id ? String(editingUser.shop_id) : "");
      setPassword("");
      setError("");
      if (isSuperAdmin) {
        api.shops.list(token).then((res: any) => setShops(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [])).catch(console.error);
      }
    }
  }, [visible, editingUser, isSuperAdmin, token]);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите имя."); return; }
    if (password && password.length < 8) {
      setError("Пароль должен быть не менее 8 символов.");
      return;
    }
    setSubmitting(true);
    if (isSuperAdmin && !shopId) {
      setError("Выберите магазин.");
      setSubmitting(false);
      return;
    }
    try {
      const payload: Partial<CreateUserPayload> = { name: name.trim(), role };
      if (isSuperAdmin && shopId) payload.shop_id = parseInt(shopId, 10);
      if (password) payload.password = password;
      const updated = await api.users.update(editingUser!.id, payload, token);
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
          <Text variant="h5" className="flex-1 text-center">Редактировать сотрудника</Text>
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
                label="Имя"
                required
                placeholder="напр. Иван Иванов"
                value={name}
                onChangeText={setName}
              />
              <Input
                label="Новый пароль"
                placeholder="Оставьте пустым, чтобы не менять"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                hint="Минимум 8 символов"
              />
              {isSuperAdmin && (
                <Select
                  label="Магазин"
                  required
                  value={shopId}
                  onValueChange={setShopId}
                  options={shops.map(s => ({ label: s.name, value: String(s.id) }))}
                  placeholder="Выберите магазин"
                />
              )}
              <Select
                label="Роль"
                value={role}
                onValueChange={(v) => setRole(v as "owner" | "seller")}
                options={roleOptions}
                placeholder="Выберите роль"
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

export default function UsersScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();

  const [users, setUsers] = React.useState<AppUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [createVisible, setCreateVisible] = React.useState(false);
  const [editVisible, setEditVisible] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<AppUser | null>(null);

  const hasAccess = can(user?.role, "users:view");

  React.useEffect(() => {
    if (!hasAccess || !token) {
      setLoading(false);
      return;
    }
    api.users
      .list(token)
      .then((res: any) => setUsers(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []))
      .catch((e) => console.error("Users fetch error:", e))
      .finally(() => setLoading(false));
  }, [token, hasAccess]);

  function fetchUsers() {
    if (!token) return Promise.resolve();
    return api.users
      .list(token)
      .then((res: any) => setUsers(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []))
      .catch((e) => console.error("Users fetch error:", e));
  }

  if (!hasAccess) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="lock" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">Нет доступа</Text>
        <Text variant="muted" className="mt-2 text-center">
          У вас нет прав для управления пользователями.
        </Text>
      </SafeAreaView>
    );
  }

  function handleDelete(id: number, name: string) {
    Alert.alert(
      "Удалить сотрудника",
      `Удалить ${name}? Это действие необратимо.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await api.users.delete(id, token!);
              setUsers((prev) => prev.filter((u) => u.id !== id));
              showToast({ message: "Сотрудник удалён", variant: "success" });
            } catch {
              showToast({ message: "Не удалось удалить сотрудника.", variant: "error" });
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text variant="h4">Сотрудники</Text>
          <Text variant="muted" className="mt-0.5">Управление командой</Text>
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
        <FlatList
          data={users}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchUsers().finally(() => setRefreshing(false));
          }}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <MaterialIcons name="group" size={48} color="#94a3b8" />
              <Text variant="muted" className="mt-3 text-center">
                {"Нет сотрудников.\nНажмите + для добавления."}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <UserCard
              item={item}
              currentUserId={user?.id}
              onEdit={() => { setEditingUser(item); setEditVisible(true); }}
              onDelete={() => handleDelete(item.id, item.name)}
              canEdit={can(user?.role, "users:edit")}
              canDelete={can(user?.role, "users:delete")}
            />
          )}
        />
      )}

      {/* FAB */}
      {can(user?.role, "users:create") && (
        <TouchableOpacity
          onPress={() => setCreateVisible(true)}
          className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg active:opacity-80"
          style={{ elevation: 6 }}
        >
          <MaterialIcons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      <CreateUserModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(u) => {
          setUsers((prev) => [u, ...prev]);
          showToast({ message: "Сотрудник создан", variant: "success" });
        }}
        token={token!}
        isSuperAdmin={user?.role === "super_admin"}
      />

      <EditUserModal
        visible={editVisible}
        editingUser={editingUser}
        onClose={() => setEditVisible(false)}
        onSaved={(updated) => {
          setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u));
          showToast({ message: "Сотрудник обновлён", variant: "success" });
        }}
        token={token!}
        isSuperAdmin={user?.role === "super_admin"}
      />
    </SafeAreaView>
  );
}
