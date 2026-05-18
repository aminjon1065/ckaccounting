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
  Avatar,
  Badge,
  Button,
  FAB,
  Input,
  Select,
  Skeleton,
  Text,
} from "@/components/ui";
import { api, ApiError, type AppUser, type CreateUserPayload, type Shop } from "@/lib/api";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";
import {
  useCreateUser,
  useDeleteUser,
  useResetPin,
  useUpdateUser,
  useUserList,
} from "@/lib/queries/users";
import { reportError } from "@/lib/observability/reporter";
import { effectiveShopId, needsShopPicker, pickerShopIds } from "@/lib/permissions";

// ─── User card ────────────────────────────────────────────────────────────────

const UserCard = React.memo(function UserCard({
  item,
  currentUserId,
  onEdit,
  onDelete,
  onResetPin,
  canEdit,
  canDelete,
  canResetPin,
}: {
  item: AppUser;
  currentUserId?: number;
  onEdit: () => void;
  onDelete: () => void;
  onResetPin?: () => void;
  canEdit: boolean;
  canDelete: boolean;
  canResetPin?: boolean;
}) {
  const isSelf = item.id === currentUserId;

  function handleLongPress() {
    const actions: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [];
    if (canEdit) actions.push({ text: "Изменить", onPress: onEdit });
    if (canResetPin && onResetPin) actions.push({ text: "Сбросить PIN", onPress: onResetPin });
    if (canDelete) actions.push({ text: "Удалить", style: "destructive", onPress: onDelete });
    actions.push({ text: "Отмена", style: "cancel" });
    Alert.alert(item.name, "Выберите действие", actions);
  }

  const hasMenuActions = (canEdit || canDelete || (canResetPin && !!onResetPin));

  const roleBadgeVariant = item.role === "owner" ? "default" : "secondary";

  return (
    <Pressable
      onPress={canEdit && !isSelf ? onEdit : undefined}
      onLongPress={hasMenuActions && !isSelf ? handleLongPress : undefined}
      disabled={!canEdit || isSelf}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-3.5 mb-2.5 border border-slate-200 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-center gap-3">
        <Avatar name={item.name} size="default" />
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-1.5 flex-wrap">
            <Text
              className="text-[15px] font-semibold text-slate-900 dark:text-white flex-shrink"
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <Badge variant={roleBadgeVariant}>{ROLE_LABELS[item.role]}</Badge>
            {isSelf && <Badge variant="secondary">Вы</Badge>}
          </View>
          <Text
            className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5"
            numberOfLines={1}
          >
            {item.email}
          </Text>
        </View>
        {!isSelf && (canEdit || canDelete) && (
          <View className="flex-row items-center gap-1.5">
            {canEdit && (
              <Pressable
                onPress={onEdit}
                hitSlop={8}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
              >
                <MaterialIcons name="edit" size={16} color="#0a7ea4" />
              </Pressable>
            )}
            {canDelete && (
              <Pressable
                onPress={onDelete}
                hitSlop={8}
                className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 items-center justify-center active:opacity-70"
              >
                <MaterialIcons name="delete-outline" size={16} color="#ef4444" />
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
});

// ─── Create user modal ────────────────────────────────────────────────────────

function CreateUserModal({
  visible,
  onClose,
  token,
  isSuperAdmin,
  showToast,
  ownerImplicitShopId,
  ownerNeedsShopPicker,
  allowedShopIds,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  isSuperAdmin: boolean;
  showToast: ReturnType<typeof useToast>["showToast"];
  /** For owner role only — their single shop, or null when picker is needed. */
  ownerImplicitShopId: number | null;
  /** For owner role only — true when they need to pick from owned set. */
  ownerNeedsShopPicker: boolean;
  /** Allowed shop ids for the current user. `null` = no restriction (super_admin). */
  allowedShopIds: number[] | null;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<"owner" | "seller">("seller");
  const [shopId, setShopId] = React.useState<string>("");
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [error, setError] = React.useState("");
  const createMutation = useCreateUser(token);
  const submitting = createMutation.isPending;

  // super_admin can create owners (no shop) or sellers (with shop). Owners
  // can only create sellers in their own shops.
  const roleOptions = isSuperAdmin
    ? [
        { label: ROLE_LABELS["owner"], value: "owner" as const },
        { label: ROLE_LABELS["seller"], value: "seller" as const },
      ]
    : [{ label: ROLE_LABELS["seller"], value: "seller" as const }];

  // Picker is needed for super_admin creating a seller, or owner with
  // multiple owned shops. super_admin creating an owner — no picker
  // (server forces shop_id=null for owners; admin assigns shop later via
  // shop edit).
  const shopPickerVisible = role === "seller"
    && (isSuperAdmin || ownerNeedsShopPicker);

  React.useEffect(() => {
    if (visible) {
      setName("");
      setEmail("");
      setPassword("");
      setRole("seller");
      setShopId("");
      setError("");
      if (isSuperAdmin || ownerNeedsShopPicker) {
        api.shops.list(token)
          .then((res) => {
            const raw = res.data ?? [];
            setShops(
              allowedShopIds == null
                ? raw
                : raw.filter((s) => allowedShopIds.includes(s.id)),
            );
          })
          .catch((e) => reportError(e, { tag: "users-create-shops-load" }));
      }
    }
  }, [visible, isSuperAdmin, ownerNeedsShopPicker, token, allowedShopIds]);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите имя."); return; }
    if (!email.trim()) { setError("Введите email."); return; }
    if (!password || password.length < 8) {
      setError("Пароль должен быть не менее 8 символов.");
      return;
    }

    // Resolve target shop_id.
    let resolvedShopId: number | null = null;
    if (role === "seller") {
      if (shopPickerVisible) {
        if (!shopId) { setError("Выберите магазин."); return; }
        resolvedShopId = parseInt(shopId, 10);
      } else if (!isSuperAdmin) {
        // Owner with single shop — implicit.
        resolvedShopId = ownerImplicitShopId;
        if (resolvedShopId === null) {
          setError("Магазин не назначен."); return;
        }
      }
    }

    const payload: CreateUserPayload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      role,
    };
    if (resolvedShopId !== null) payload.shop_id = resolvedShopId;
    try {
      await createMutation.mutateAsync({ payload });
      showToast({ message: "Сотрудник добавлен", variant: "success" });
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
              Новый сотрудник
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Имя, email и роль
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
              {/* Role picker only for super_admin (owners can only create sellers). */}
              {isSuperAdmin && (
                <Select
                  label="Роль"
                  value={role}
                  onValueChange={(v) => setRole(v as "owner" | "seller")}
                  options={roleOptions}
                  placeholder="Выберите роль"
                />
              )}
              {/* Shop picker:                                                  */}
              {/*   • super_admin + role=seller — pick any shop                  */}
              {/*   • owner + multi-shop          — pick from owned set           */}
              {/* No picker when super_admin creates owner (server null'd) or    */}
              {/* owner has just one shop (implicit).                            */}
              {shopPickerVisible && (
                <Select
                  label="Магазин"
                  required
                  value={shopId}
                  onValueChange={setShopId}
                  options={shops.map(s => ({ label: s.name, value: String(s.id) }))}
                  placeholder="Выберите магазин"
                />
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
  onMissing,
  token,
  isSuperAdmin,
  showToast,
  ownerNeedsShopPicker,
  allowedShopIds,
}: {
  visible: boolean;
  editingUser: AppUser | null;
  onClose: () => void;
  /** Server reported the user no longer exists (404). */
  onMissing: (id: number) => void;
  token: string;
  isSuperAdmin: boolean;
  showToast: ReturnType<typeof useToast>["showToast"];
  /** Owner editing seller — show picker only when owner has multiple shops. */
  ownerNeedsShopPicker: boolean;
  /** Allowed shop ids for the current user. `null` = no restriction (super_admin). */
  allowedShopIds: number[] | null;
}) {
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<"owner" | "seller">("seller");
  const [shopId, setShopId] = React.useState<string>("");
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [error, setError] = React.useState("");
  const updateMutation = useUpdateUser(token);
  const submitting = updateMutation.isPending;

  const roleOptions = isSuperAdmin
    ? [
        { label: ROLE_LABELS["owner"], value: "owner" as const },
        { label: ROLE_LABELS["seller"], value: "seller" as const },
      ]
    : [{ label: ROLE_LABELS["seller"], value: "seller" as const }];

  // Picker visible for super_admin editing seller, or owner with multi-shop
  // editing seller. Editing an owner — no picker (server keeps shop_id null).
  const editingSelf = editingUser?.role === "seller";
  const shopPickerVisible = editingSelf
    && (isSuperAdmin || ownerNeedsShopPicker);

  React.useEffect(() => {
    if (visible && editingUser) {
      setName(editingUser.name);
      setRole(editingUser.role as "owner" | "seller");
      setShopId(editingUser.shop_id ? String(editingUser.shop_id) : "");
      setPassword("");
      setError("");
      if (isSuperAdmin || ownerNeedsShopPicker) {
        api.shops.list(token)
          .then((res) => {
            const raw = res.data ?? [];
            setShops(
              allowedShopIds == null
                ? raw
                : raw.filter((s) => allowedShopIds.includes(s.id)),
            );
          })
          .catch((e) => reportError(e, { tag: "users-edit-shops-load" }));
      }
    }
  }, [visible, editingUser, isSuperAdmin, ownerNeedsShopPicker, token, allowedShopIds]);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите имя."); return; }
    if (password && password.length < 8) {
      setError("Пароль должен быть не менее 8 символов.");
      return;
    }
    if (shopPickerVisible && !shopId) {
      setError("Выберите магазин.");
      return;
    }
    const payload: Partial<CreateUserPayload> = { name: name.trim(), role };
    if (shopPickerVisible && shopId) payload.shop_id = parseInt(shopId, 10);
    if (password) payload.password = password;
    try {
      await updateMutation.mutateAsync({ id: editingUser!.id, payload });
      showToast({ message: "Сотрудник обновлён", variant: "success" });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else if (e instanceof ApiError && e.status === 404) {
        onMissing(editingUser!.id);
        onClose();
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Что-то пошло не так.");
      }
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
              {editingUser?.name ?? "Сотрудник"}
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Доступы и роль
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
              {shopPickerVisible && (
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

  const query = useUserList(token);
  const deleteMutation = useDeleteUser(token);
  const resetPinMutation = useResetPin(token);
  const users = React.useMemo<AppUser[]>(() => query.data ?? [], [query.data]);
  const loading = query.isPending && users.length === 0;
  const refreshing = query.isRefetching;

  const [createVisible, setCreateVisible] = React.useState(false);
  const [editVisible, setEditVisible] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<AppUser | null>(null);

  const hasAccess = can(user?.role, "users:view");

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

  async function handleResetPin(id: number, name: string) {
    Alert.alert(
      "Сбросить PIN сотрудника",
      `Сбросить PIN у ${name}? После этого сотруднику придётся заново войти и задать новый PIN.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Сбросить",
          style: "destructive",
          onPress: async () => {
            try {
              await resetPinMutation.mutateAsync({ id });
              showToast({ message: "PIN сброшен. Сотрудник задаст новый при следующем входе.", variant: "success" });
            } catch (e) {
              if (e instanceof ApiError && e.status === 0) {
                showToast({ message: "Нет сети. Сброс PIN требует подключения к интернету.", variant: "warning" });
              } else if (e instanceof ApiError && e.status === 404) {
                showToast({ message: "Сотрудник был удалён.", variant: "error" });
              } else {
                showToast({ message: e instanceof ApiError ? e.message : "Не удалось сбросить PIN.", variant: "error" });
              }
            }
          },
        },
      ]
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
              await deleteMutation.mutateAsync({ id });
              showToast({ message: "Сотрудник удалён", variant: "success" });
            } catch (e) {
              if (e instanceof ApiError && e.status === 0) {
                showToast({
                  message: "Нет соединения. Проверьте интернет и попробуйте снова.",
                  variant: "error",
                });
              } else if (e instanceof ApiError && e.status === 404) {
                showToast({
                  message: "Сотрудник уже был удалён.",
                  variant: "success",
                });
              } else {
                showToast({ message: "Не удалось удалить сотрудника.", variant: "error" });
              }
            }
          },
        },
      ]
    );
  }

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
            Сотрудники
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            Доступы и роли
          </Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 px-4 pt-2">
          {[1, 2, 3].map((i) => (
            <View key={i} className="mb-2.5">
              <Skeleton className="h-[72px] rounded-2xl" />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={() => query.refetch().catch(() => {})}
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
              onResetPin={() => handleResetPin(item.id, item.name)}
              canEdit={can(user?.role, "users:edit")}
              canDelete={can(user?.role, "users:delete")}
              canResetPin={user?.role === "super_admin"}
            />
          )}
        />
      )}

      {/* FAB */}
      {can(user?.role, "users:create") && (
        <FAB onPress={() => setCreateVisible(true)} />
      )}

      <CreateUserModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        token={token!}
        isSuperAdmin={user?.role === "super_admin"}
        showToast={showToast}
        ownerImplicitShopId={effectiveShopId(user)}
        ownerNeedsShopPicker={user?.role === "owner" && needsShopPicker(user)}
        allowedShopIds={pickerShopIds(user)}
      />

      <EditUserModal
        visible={editVisible}
        editingUser={editingUser}
        onClose={() => setEditVisible(false)}
        onMissing={() => {
          // Mutation already rolled back optimistic state; the list will
          // refetch on the next focus / pull-to-refresh.
          showToast({
            message: "Сотрудник был удалён.",
            variant: "error",
          });
        }}
        token={token!}
        isSuperAdmin={user?.role === "super_admin"}
        showToast={showToast}
        ownerNeedsShopPicker={user?.role === "owner" && needsShopPicker(user)}
        allowedShopIds={pickerShopIds(user)}
      />
    </SafeAreaView>
  );
}
