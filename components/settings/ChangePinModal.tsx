import * as React from "react";
import { Modal, Pressable, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Text } from "@/components/ui";
import { PinKeypad } from "@/components/auth/PinKeypad";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

type Stage = "verify" | "enter" | "confirm";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** True if a PIN is already set — the modal will require the current one first. */
  hasExistingPin: boolean;
}

export function ChangePinModal({ visible, onClose, hasExistingPin }: Props) {
  const { setPin, verifyPin } = useAuth();
  const { showToast } = useToast();

  const [stage, setStage] = React.useState<Stage>(hasExistingPin ? "verify" : "enter");
  const [value, setValue] = React.useState("");
  const [firstPin, setFirstPin] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setStage(hasExistingPin ? "verify" : "enter");
    setValue("");
    setFirstPin("");
    setError("");
    setBusy(false);
  }, [visible, hasExistingPin]);

  const handleComplete = async (pin: string) => {
    if (stage === "verify") {
      setBusy(true);
      const ok = await verifyPin(pin);
      setBusy(false);
      if (!ok) {
        setError("Неверный PIN. Попробуйте снова.");
        setValue("");
        return;
      }
      setError("");
      setValue("");
      setStage("enter");
      return;
    }
    if (stage === "enter") {
      setFirstPin(pin);
      setValue("");
      setError("");
      setStage("confirm");
      return;
    }
    // confirm
    if (pin !== firstPin) {
      setError("PIN-коды не совпадают. Попробуйте снова.");
      setValue("");
      setFirstPin("");
      setStage("enter");
      return;
    }
    setBusy(true);
    try {
      await setPin(pin);
      showToast({ message: "PIN-код обновлён", variant: "success" });
      onClose();
    } catch {
      setError("Не удалось сохранить PIN. Попробуйте снова.");
      setValue("");
      setFirstPin("");
      setStage("enter");
    } finally {
      setBusy(false);
    }
  };

  const handleBack = () => {
    // From confirm → re-enter; from verify/enter → close the modal.
    if (stage === "confirm") {
      setStage("enter");
      setValue("");
      setFirstPin("");
      setError("");
      return;
    }
    onClose();
  };

  const title =
    stage === "verify"
      ? "Введите текущий PIN"
      : stage === "enter"
        ? "Новый PIN-код"
        : "Повторите PIN-код";

  const subtitle =
    stage === "verify"
      ? "Подтвердите, что это вы."
      : stage === "enter"
        ? "4 цифры. Используется при недоступной биометрии."
        : "Введите тот же PIN ещё раз, чтобы подтвердить.";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleBack}>
      <View className="flex-1 bg-slate-50 dark:bg-zinc-950">
        <View className="flex-1 px-6 pt-14 pb-6">
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            className="flex-row items-center -ml-1.5 mb-4 self-start active:opacity-60"
          >
            <MaterialIcons name="chevron-left" size={22} color="#64748b" />
            <Text className="text-slate-500 dark:text-zinc-400 text-[14px]">
              {stage === "confirm" ? "Назад" : "Отмена"}
            </Text>
          </Pressable>

          <Text className="text-slate-500 dark:text-zinc-400 text-[12px] font-semibold uppercase tracking-[0.8px] mt-3">
            PIN-код
          </Text>
          <Text className="font-heading text-[26px] leading-[32px] text-slate-900 dark:text-white mt-1.5 tracking-tight">
            {title}
          </Text>
          <Text className="text-slate-500 dark:text-zinc-400 text-[13.5px] leading-[20px] mt-1.5">
            {subtitle}
          </Text>

          <View className="flex-1 justify-end">
            <PinKeypad
              value={value}
              onChange={(v) => {
                setValue(v);
                if (error) setError("");
              }}
              onComplete={handleComplete}
              error={error || null}
              disabled={busy}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
