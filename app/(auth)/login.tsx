import { Alert, Button, Input, Text } from "@/components/ui";
import { useLocalSearchParams } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { ActivityIndicator, Alert as RNAlertDialog } from "react-native";
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
import { useSyncMethods } from "@/lib/sync/SyncContext";
import { useIsOnline } from "@/lib/sync/syncStore";

// Cap initial post-login pull at 12s. If the network is slow, fall through
// to the tabs anyway — SyncProvider keeps polling in the background and the
// data will appear once it arrives.
const BOOTSTRAP_TIMEOUT_MS = 12_000;

export default function LoginScreen() {
  const { signIn, signInOffline, hasCredentials, setPin, hasPin, verifyPin, setPinSetupPending, pinSetupPending, bootstrapPending, completeBootstrap, token } = useAuth();
  const { runFullSync } = useSyncMethods();
  const isOnline = useIsOnline();
  const searchParams = useLocalSearchParams();
  const tokenExpiredReason = searchParams?.reason === "expired";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [showPinSetup, setShowPinSetup] = React.useState(false);

  // If we already have a session token but PIN is missing (e.g. fresh install
  // restoring a token, or a server-initiated PIN reset), force the setup flow.
  React.useEffect(() => {
    if (token && pinSetupPending) setShowPinSetup(true);
  }, [token, pinSetupPending]);

  // Initial bootstrap pull: fires once after PIN setup is done (or skipped)
  // and bootstrapPending is still armed. Awaits the first remote pull so the
  // user lands in tabs with their data already in SQLite. Bounded by a
  // timeout so a flaky network doesn't trap the user on the login screen.
  const bootstrapStartedRef = React.useRef(false);
  React.useEffect(() => {
    if (!bootstrapPending) {
      bootstrapStartedRef.current = false;
      return;
    }
    if (pinSetupPending) return; // wait for PIN setup to clear first
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        if (!isOnline) {
          // Online sign-in already succeeded, but the device dropped offline
          // before the pull could start. Skip the gate — SyncProvider will
          // catch up automatically once connectivity returns.
          return;
        }
        await Promise.race([
          runFullSync(),
          new Promise<void>((resolve) => setTimeout(resolve, BOOTSTRAP_TIMEOUT_MS)),
        ]);
      } finally {
        if (!cancelled) completeBootstrap();
      }
    })();

    return () => { cancelled = true; };
  }, [bootstrapPending, pinSetupPending, isOnline, runFullSync, completeBootstrap]);
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

  // Show session expired message when redirected from token expiry
  React.useEffect(() => {
    if (tokenExpiredReason) {
      RNAlertDialog.alert(
        "Сессия истекла",
        "Ваша сессия истекла. Пожалуйста, войдите снова.",
        [{ text: "OK" }]
      );
    }
  }, [tokenExpiredReason]);

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
        setPinSetupPending(true);
        setShowPinSetup(true);
      } else {
        setPinSetupPending(false);
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
        setPinSetupPending(true);
        setShowPinSetup(true);
      } else {
        setPinSetupPending(false);
      }
    } else {
      setError("Не удалось войти офлайн. Проверьте подключение.");
    }
  }

  async function handlePinSubmit() {
    if (pinValue.length !== 4) {
      setPinError("PIN должен быть из 4 цифр.");
      return;
    }
    if (pinValue !== pinConfirm) {
      setPinError("PIN-коды не совпадают.");
      return;
    }
    setPinError("");
    try {
      await setPin(pinValue);
      setPinSetupPending(false);
      // Drop the local PIN-setup view so the bootstrap loader (or AuthGuard
      // routing to tabs) can take over on the next render.
      setShowPinSetup(false);
      setPinValue("");
      setPinConfirm("");
    } catch {
      setPinError("Не удалось сохранить PIN. Попробуйте снова.");
    }
  }

  // ── Bootstrap loading screen (post-login initial data pull) ──────────────────
  // Shown after the user authenticates (and finished PIN setup, if needed)
  // while the first remote pull populates SQLite. Replaces the empty-tabs
  // flicker on first login. Falls through automatically on success or timeout.
  if (token && bootstrapPending && !pinSetupPending && !showPinSetup && !showPinVerify) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-zinc-950">
        <View className="flex-1 items-center justify-center px-6">
          <View className="w-16 h-16 rounded-2xl bg-primary-500 items-center justify-center mb-5">
            <MaterialIcons name="cloud-download" size={28} color="#fff" />
          </View>
          <Text variant="h2" className="text-center">
            Загрузка данных
          </Text>
          <Text variant="muted" className="text-center mt-2">
            {isOnline
              ? "Загружаем ваши товары, продажи и долги из облака…"
              : "Нет сети. Запускаем приложение в офлайн-режиме…"}
          </Text>
          <ActivityIndicator size="large" className="mt-6" />
        </View>
      </SafeAreaView>
    );
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
                maxLength={4}
                secureTextEntry
                value={pinVerifyValue}
                onChangeText={(t) => setPinVerifyValue(t.replace(/\D/g, "").slice(0, 4))}
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
                Создайте PIN-код
              </Text>
              <Text variant="muted" className="text-center mt-2 text-center">
                4-значный PIN обязателен для входа в приложение. Он используется при каждом запуске и в офлайн-режиме.
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
                placeholder="4 цифры"
                value={pinValue}
                onChangeText={(t) => {
                  setPinValue(t.replace(/\D/g, "").slice(0, 4));
                  if (pinError) setPinError("");
                }}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                leftIcon={
                  <MaterialIcons name="pin" size={18} color="#94a3b8" />
                }
              />

              <Input
                label="Подтвердите PIN"
                placeholder="Повторите PIN"
                value={pinConfirm}
                onChangeText={(t) => {
                  setPinConfirm(t.replace(/\D/g, "").slice(0, 4));
                  if (pinError) setPinError("");
                }}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                leftIcon={
                  <MaterialIcons name="pin" size={18} color="#94a3b8" />
                }
              />

              <Button
                className="mt-2"
                size="lg"
                onPress={handlePinSubmit}
                disabled={pinValue.length !== 4 || pinConfirm.length !== 4}
              >
                Сохранить PIN
              </Button>
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
