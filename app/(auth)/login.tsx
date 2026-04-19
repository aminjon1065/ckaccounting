import { Alert, Button, Input, Text } from "@/components/ui";
import { useRouter } from "expo-router";
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

import { ApiError } from "@/lib/api";
import { useAuth } from "@/store/auth";

export default function LoginScreen() {
  const { signIn, signInOffline, hasCredentials, setPin, hasPin, verifyPin } = useAuth();
  const router = useRouter();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [showPinSetup, setShowPinSetup] = React.useState(false);
  const [pinValue, setPinValue] = React.useState("");
  const [pinConfirm, setPinConfirm] = React.useState("");
  const [pinError, setPinError] = React.useState("");
  const [showPinVerify, setShowPinVerify] = React.useState(false);
  const [pinVerifyValue, setPinVerifyValue] = React.useState("");
  const [pendingCredentials, setPendingCredentials] = React.useState<{
    email: string;
    password: string;
  } | null>(null);
  const [hasOfflineCreds, setHasOfflineCreds] = React.useState(false);

  const passwordRef = React.useRef<TextInput>(null);

  // Check for cached credentials on mount
  React.useEffect(() => {
    hasCredentials().then(setHasOfflineCreds);
  }, []);

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
      // After successful login, check if PIN is set — if not, prompt setup
      const pinSet = await hasPin();
      if (!pinSet) {
        setShowPinSetup(true);
      } else {
        router.replace("/(tabs)");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError("Слишком много попыток входа. Повторите через несколько минут.");
      } else if (err instanceof ApiError && err.status === 0) {
        // No network — check if we have cached credentials for offline login
        const hasCached = await hasCredentials();
        if (hasCached) {
          setPendingCredentials({ email: trimmedEmail, password });
          setError("");
        } else {
          setError("Нет сети. Войдите при наличии интернета.");
        }
      } else {
        setError(
          err instanceof Error ? err.message : "Ошибка входа. Попробуйте снова.",
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleOfflineLogin() {
    setLoading(true);
    setError("");
    // PIN is required to use offline login — prevents unauthorized access to cached session
    setShowPinVerify(true);
    setLoading(false);
  }

  async function handlePinVerifySubmit() {
    if (!pinVerifyValue) return;
    const valid = await verifyPin(pinVerifyValue);
    if (!valid) {
      setError("Неверный PIN. Попробуйте снова.");
      setPinVerifyValue("");
      return;
    }
    setError("");
    const success = await signInOffline();
    if (success) {
      setShowPinVerify(false);
      setPinVerifyValue("");
      const pinSet = await hasPin();
      if (!pinSet) {
        setShowPinSetup(true);
      } else {
        router.replace("/(tabs)");
      }
    } else {
      setError("Не удалось войти офлайн. Проверьте подключение.");
    }
  }

  async function handlePinSubmit() {
    if (pinValue.length < 4 || pinValue.length > 6) {
      setPinError("PIN должен быть от 4 до 6 цифр.");
      return;
    }
    if (pinValue !== pinConfirm) {
      setPinError("PIN-коды не совпадают.");
      return;
    }
    setPinError("");
    try {
      await setPin(pinValue);
      router.replace("/(tabs)");
    } catch {
      setPinError("Не удалось сохранить PIN. Попробуйте снова.");
    }
  }

  // ── PIN Verify Screen (before offline login) ─────────────────────────────────
  if (showPinVerify) {
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
            <View className="items-center mb-8">
              <View className="w-16 h-16 rounded-2xl bg-primary-500 items-center justify-center mb-4">
                <MaterialIcons name="lock-outline" size={28} color="#fff" />
              </View>
              <Text variant="h2" className="text-center">
                Введите PIN
              </Text>
              <Text variant="muted" className="text-center mt-2 text-center">
                Для входа офлайн введите PIN-код.
              </Text>
            </View>

            {!!error && (
              <Alert
                variant="destructive"
                title="Ошибка"
                description={error}
                className="mb-4"
              />
            )}

            <View className="gap-4">
              <TextInput
                className="border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-base bg-white dark:bg-zinc-900 text-gray-900 dark:text-white text-center tracking-widest"
                placeholder="****"
                placeholderTextColor="gray"
                keyboardType="number-pad"
                maxLength={6}
                secureTextEntry
                value={pinVerifyValue}
                onChangeText={setPinVerifyValue}
              />
              <Button onPress={handlePinVerifySubmit}>
                Войти
              </Button>
              <Button
                variant="ghost"
                onPress={() => { setShowPinVerify(false); setPinVerifyValue(""); setError(""); }}
              >
                Назад
              </Button>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── PIN Setup Screen ─────────────────────────────────────────────────────────
  if (showPinSetup) {
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
            <View className="items-center mb-8">
              <View className="w-16 h-16 rounded-2xl bg-primary-500 items-center justify-center mb-4">
                <MaterialIcons name="lock" size={28} color="#fff" />
              </View>
              <Text variant="h2" className="text-center">
                Защитите аккаунт
              </Text>
              <Text variant="muted" className="text-center mt-2 text-center">
                Создайте PIN-код для быстрого входа. Используется как резервный способ, если биометрия недоступна.
              </Text>
            </View>

            {!!pinError && (
              <Alert
                variant="destructive"
                title="Ошибка"
                description={pinError}
                className="mb-4"
              />
            )}

            <View className="gap-4">
              <Input
                label="PIN-код"
                placeholder="4–6 цифр"
                value={pinValue}
                onChangeText={(t) => {
                  setPinValue(t.replace(/\D/g, "").slice(0, 6));
                  if (pinError) setPinError("");
                }}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                leftIcon={
                  <MaterialIcons name="pin" size={18} color="#94a3b8" />
                }
              />

              <Input
                label="Подтвердите PIN"
                placeholder="Повторите PIN"
                value={pinConfirm}
                onChangeText={(t) => {
                  setPinConfirm(t.replace(/\D/g, "").slice(0, 6));
                  if (pinError) setPinError("");
                }}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                leftIcon={
                  <MaterialIcons name="pin" size={18} color="#94a3b8" />
                }
              />

              <Button
                className="mt-2"
                size="lg"
                onPress={handlePinSubmit}
                disabled={pinValue.length < 4 || pinConfirm.length < 4}
              >
                Сохранить PIN
              </Button>

              <Pressable
                className="items-center mt-2"
                onPress={() => {
                  setShowPinSetup(false);
                  setPinValue("");
                  setPinConfirm("");
                  setPinError("");
                }}
              >
                <Text variant="small" className="text-slate-400">
                  Пропустить
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
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

            {/* ── Offline login ── */}
            {hasOfflineCreds && pendingCredentials && (
              <Button
                variant="outline"
                size="lg"
                onPress={handleOfflineLogin}
                loading={loading}
                disabled={loading}
                className="border-slate-300 dark:border-slate-600"
              >
                <View className="flex-row items-center gap-2">
                  <MaterialIcons name="cloud-off" size={18} color="#94a3b8" />
                  <Text variant="muted" className="text-slate-500">
                    Войти офлайн
                  </Text>
                </View>
              </Button>
            )}
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
