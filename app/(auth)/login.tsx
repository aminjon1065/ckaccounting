import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import { Alert, Button, Input, Text } from "@/components/ui";
import { useAuth } from "@/store/auth";

export default function LoginScreen() {
  const { signIn } = useAuth();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const passwordRef = React.useRef<TextInput>(null);

  async function handleLogin() {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setError("Введите email и пароль.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      await signIn({ email: trimmedEmail, password, device_name: Platform.OS });
      // AuthGuard in _layout.tsx handles the redirect automatically
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Ошибка входа. Попробуйте снова.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-zinc-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
            paddingVertical: 48,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Logo ── */}
          <View className="items-center mb-10">
            <View className="w-20 h-20 rounded-3xl bg-primary-500 items-center justify-center mb-5 shadow-lg">
              <MaterialIcons name="account-balance" size={38} color="#fff" />
            </View>
            <Text variant="h2" className="text-center tracking-tight">
              CK Accounting
            </Text>
            <Text variant="muted" className="text-center mt-1.5">
              Войдите для управления бизнесом
            </Text>
          </View>

          {/* ── Error banner ── */}
          {!!error && (
            <Alert
              variant="destructive"
              title="Ошибка входа"
              description={error}
              icon={
                <MaterialIcons name="error-outline" size={16} color="#b91c1c" />
              }
              className="mb-5"
            />
          )}

          {/* ── Form ── */}
          <View className="gap-4">
            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                if (error) setError("");
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              leftIcon={
                <MaterialIcons name="email" size={18} color="#94a3b8" />
              }
            />

            <Input
              ref={passwordRef}
              label="Пароль"
              placeholder="••••••••"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (error) setError("");
              }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              leftIcon={<MaterialIcons name="lock" size={18} color="#94a3b8" />}
              rightIcon={
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={12}
                  className="active:opacity-60"
                >
                  <MaterialIcons
                    name={showPassword ? "visibility-off" : "visibility"}
                    size={18}
                    color="#94a3b8"
                  />
                </Pressable>
              }
            />

            <Button
              className="mt-2"
              size="lg"
              onPress={handleLogin}
              loading={loading}
              disabled={loading}
            >
              Войти
            </Button>
          </View>

          {/* ── Footer ── */}
          <View className="flex-row items-center justify-center gap-1.5 mt-10">
            <MaterialIcons name="lock-outline" size={13} color="#94a3b8" />
            <Text variant="small" className="text-slate-400">
              Защищено сквозным шифрованием
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
