import { Alert, Button, Input, Text } from "@/components/ui";
import { useLocalSearchParams } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import * as React from "react";
import { Alert as RNAlertDialog } from "react-native";
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
import { PinKeypad } from "@/components/auth/PinKeypad";

export default function LoginScreen() {
  const { signIn, signInOffline, hasCredentials, setPin, hasPin, verifyPin, setPinSetupPending, pinSetupPending, token } = useAuth();
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

  // Post-login data fetching is handled by React Query — each screen's
  // `useQuery` fires when its component mounts, so we no longer need to
  // trigger a manual cache pull here.

  // Two-stage PIN setup: user enters a PIN, then confirms it. We don't show
  // both fields at once — typing into one numeric pad is faster, and the
  // confirm stage is the natural place to surface a "mismatch" error.
  const [pinValue, setPinValue] = React.useState("");
  const [pinStage, setPinStage] = React.useState<"enter" | "confirm">("enter");
  const [firstPin, setFirstPin] = React.useState("");
  const [pinError, setPinError] = React.useState("");
  const [pinSaving, setPinSaving] = React.useState(false);
  const [showPinVerify, setShowPinVerify] = React.useState(false);
  const [pinVerifyValue, setPinVerifyValue] = React.useState("");
  const [pinVerifying, setPinVerifying] = React.useState(false);
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

    const tHandle = __DEV__ ? Date.now() : 0;
    try {
      await signIn({ email: trimmedEmail, password, device_name: Platform.OS });
      if (__DEV__) console.log(`[handleLogin] signIn done @${Date.now() - tHandle}ms`);
      // After successful login, check if PIN is set — if not, prompt setup
      const pinSet = await hasPin();
      if (__DEV__) console.log(`[handleLogin] hasPin done @${Date.now() - tHandle}ms (pinSet=${pinSet})`);
      if (!pinSet) {
        setPinSetupPending(true);
        setShowPinSetup(true);
      } else {
        setPinSetupPending(false);
      }
      if (__DEV__) console.log(`[handleLogin] setShowPinSetup done @${Date.now() - tHandle}ms`);
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

  async function handlePinVerifySubmit(pin: string) {
    if (pin.length !== 4 || pinVerifying) return;
    setPinVerifying(true);
    const valid = await verifyPin(pin);
    if (!valid) {
      setError("Неверный PIN. Попробуйте снова.");
      setPinVerifyValue("");
      setPinVerifying(false);
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
    setPinVerifying(false);
  }

  async function handlePinSetupComplete(pin: string) {
    if (pinStage === "enter") {
      setFirstPin(pin);
      setPinValue("");
      setPinError("");
      setPinStage("confirm");
      return;
    }
    // confirm stage
    if (pin !== firstPin) {
      setPinError("PIN-коды не совпадают. Попробуйте снова.");
      setPinValue("");
      setFirstPin("");
      setPinStage("enter");
      return;
    }
    setPinError("");
    setPinSaving(true);
    try {
      await setPin(pin);
      setPinSetupPending(false);
      setShowPinSetup(false);
      setPinValue("");
      setFirstPin("");
      setPinStage("enter");
    } catch {
      setPinError("Не удалось сохранить PIN. Попробуйте снова.");
      setPinValue("");
      setFirstPin("");
      setPinStage("enter");
    } finally {
      setPinSaving(false);
    }
  }

  // ── PIN Verify Screen (before offline login) ─────────────────────────────────
  if (showPinVerify) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        <View className="flex-1 px-6 pt-6 pb-6">
          {/* Back link */}
          <Pressable
            onPress={() => { setShowPinVerify(false); setPinVerifyValue(""); setError(""); }}
            hitSlop={12}
            className="flex-row items-center -ml-1.5 mb-4 self-start active:opacity-60"
          >
            <MaterialIcons name="chevron-left" size={22} color="#64748b" />
            <Text className="text-slate-500 dark:text-zinc-400 text-[14px]">Назад</Text>
          </Pressable>

          {/* Heading */}
          <Text className="text-slate-500 dark:text-zinc-400 text-[12px] font-semibold uppercase tracking-[0.8px] mt-3">
            Офлайн-вход
          </Text>
          <Text className="font-heading text-[26px] leading-[32px] text-slate-900 dark:text-white mt-1.5 tracking-tight">
            Введите PIN-код
          </Text>
          <Text className="text-slate-500 dark:text-zinc-400 text-[13.5px] leading-[20px] mt-1.5">
            Без интернета вход возможен только по PIN-коду. Биометрия отключена в этом сеансе.
          </Text>

          {/* Dots + keypad */}
          <View className="flex-1 justify-end">
            <PinKeypad
              value={pinVerifyValue}
              onChange={(v) => { setPinVerifyValue(v); if (error) setError(""); }}
              onComplete={handlePinVerifySubmit}
              error={error || null}
              disabled={pinVerifying}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── PIN Setup Screen ─────────────────────────────────────────────────────────
  if (showPinSetup) {
    const isConfirm = pinStage === "confirm";
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        <View className="flex-1 px-6 pt-6 pb-6">
          {/* Back link (only visible on confirm stage — allows redo) */}
          {isConfirm ? (
            <Pressable
              onPress={() => { setPinValue(""); setFirstPin(""); setPinStage("enter"); setPinError(""); }}
              hitSlop={12}
              className="flex-row items-center -ml-1.5 mb-4 self-start active:opacity-60"
            >
              <MaterialIcons name="chevron-left" size={22} color="#64748b" />
              <Text className="text-slate-500 dark:text-zinc-400 text-[14px]">Назад</Text>
            </Pressable>
          ) : (
            <View className="h-[26px] mb-4" />
          )}

          {/* Step counter */}
          <Text className="text-slate-500 dark:text-zinc-400 text-[12px] font-semibold uppercase tracking-[0.8px] mt-3">
            Шаг {isConfirm ? "2" : "1"} из 2
          </Text>
          <Text className="font-heading text-[26px] leading-[32px] text-slate-900 dark:text-white mt-1.5 tracking-tight">
            {isConfirm ? "Повторите PIN-код" : "Придумайте PIN-код"}
          </Text>
          <Text className="text-slate-500 dark:text-zinc-400 text-[13.5px] leading-[20px] mt-1.5">
            {isConfirm
              ? "Введите тот же PIN ещё раз, чтобы подтвердить."
              : "4 цифры. Используется, если Face ID или отпечаток недоступны."}
          </Text>

          {/* Dots + keypad */}
          <View className="flex-1 justify-end">
            <PinKeypad
              value={pinValue}
              onChange={(v) => { setPinValue(v); if (pinError) setPinError(""); }}
              onComplete={handlePinSetupComplete}
              error={pinError || null}
              disabled={pinSaving}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      <KeyboardAvoidingView
        // "padding" on both platforms — Android `adjustResize` already
        // shrinks the window, and pairing with "height" double-shrunk the
        // KAV so the focused input slid under the keyboard.
        behavior="padding"
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
            paddingTop: 32,
            paddingBottom: 24,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Brand icon ── */}
          <View className="items-center mb-10">
            <Image
              source={require("@/assets/images/ckicon.png")}
              style={{ width: 96, height: 96 }}
              contentFit="contain"
            />
          </View>

          {/* ── Heading ── */}
          <Text className="font-heading text-[28px] leading-[34px] text-slate-900 dark:text-white tracking-tight text-center mb-7">
            Войти в аккаунт
          </Text>

          {/* ── Error banner ── */}
          {!!error && (
            <Alert
              variant="destructive"
              title="Ошибка входа"
              description={error}
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
          <View className="flex-row items-center justify-center gap-1.5 pt-10">
            <MaterialIcons name="lock" size={13} color="#94a3b8" />
            <Text className="text-slate-400 dark:text-zinc-500 text-[12px]">
              Данные защищены SecureStore
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
