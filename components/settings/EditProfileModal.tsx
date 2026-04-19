import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Modal, ScrollView, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Separator, Text } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { queueSyncAction } from "@/lib/db";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

export function EditProfileModal({
  visible,
  onClose,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
}) {
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  const [name, setName] = React.useState("");
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setName(user?.name ?? "");
      setCurrentPassword("");
      setNewPassword("");
      setError("");
    }
  }, [visible, user]);

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Введите имя."); return; }
    if (newPassword && newPassword.length < 8) {
      setError("Новый пароль должен быть не менее 8 символов.");
      return;
    }
    if (newPassword && !currentPassword) {
      setError("Введите текущий пароль для смены пароля.");
      return;
    }
    setSubmitting(true);
    const payload: { name: string; current_password?: string; password?: string } = {
      name: name.trim(),
    };
    if (newPassword) {
      payload.current_password = currentPassword;
      payload.password = newPassword;
    }
    try {
      const updated = await api.profile.update(payload, token);
      await updateUser(updated);
      showToast({ message: "Профиль обновлён", variant: "success" });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        await queueSyncAction("PATCH", "/profile", payload, {});
        // Update local auth state optimistically
        if (user) {
          await updateUser({ ...user, name: name.trim() });
        }
        showToast({ message: "Нет сети. Профиль сохранён локально.", variant: "warning" });
        onClose();
      } else {
        setError(e instanceof ApiError ? e.message : "Не удалось сохранить профиль.");
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
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">Редактировать профиль</Text>
          <View style={{ width: 22 }} />
        </View>

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
              placeholder="Ваше имя"
              value={name}
              onChangeText={setName}
            />

            <Separator />

            <Text className="text-xs font-medium text-slate-500 -mb-2">
              Смена пароля (необязательно)
            </Text>
            <Input
              label="Текущий пароль"
              placeholder="Текущий пароль"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
            />
            <Input
              label="Новый пароль"
              placeholder="Минимум 8 символов"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
          </View>

          <Button
            className="mt-6"
            size="lg"
            onPress={handleSave}
            loading={submitting}
            disabled={submitting}
          >
            Сохранить
          </Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
