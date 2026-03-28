import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as React from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Select, Text } from "@/components/ui";
import {
  api,
  ApiError,
  type CreateProductPayload,
  type Product,
  type Shop,
} from "@/lib/api";

interface FormModalProps {
  visible: boolean;
  editing: Product | null;
  onClose: () => void;
  onSaved: (p: Product, wasEditing: boolean) => void;
  token: string;
  isSuperAdmin: boolean;
}

export function ProductFormModal({
  visible,
  editing,
  onClose,
  onSaved,
  token,
  isSuperAdmin,
}: FormModalProps) {
  const [shopId, setShopId] = React.useState<string>("");
  const [shops, setShops] = React.useState<Shop[]>([]);

  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [costPrice, setCostPrice] = React.useState("");
  const [salePrice, setSalePrice] = React.useState("");
  const [stock, setStock] = React.useState("");
  const [lowAlert, setLowAlert] = React.useState("");
  const [photoUri, setPhotoUri] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Refs for focus chain
  const codeRef = React.useRef<RNTextInput>(null);
  const unitRef = React.useRef<RNTextInput>(null);
  const costRef = React.useRef<RNTextInput>(null);
  const saleRef = React.useRef<RNTextInput>(null);
  const stockRef = React.useRef<RNTextInput>(null);
  const alertRef = React.useRef<RNTextInput>(null);

  React.useEffect(() => {
    if (visible && isSuperAdmin) {
      api.shops.list(token).then((res: any) => setShops(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [])).catch(console.error);
    }
  }, [visible, isSuperAdmin, token]);

  React.useEffect(() => {
    if (visible && editing) {
      setName(editing.name);
      setCode(editing.code ?? "");
      setUnit(editing.unit ?? "");
      setCostPrice(String(editing.cost_price));
      setSalePrice(String(editing.sale_price));
      setStock(String(editing.stock_quantity));
      setLowAlert(editing.low_stock_alert != null ? String(editing.low_stock_alert) : "");
      setPhotoUri(editing.photo_url ?? null);
      setShopId(editing.shop_id ? String(editing.shop_id) : "");
    } else if (visible && !editing) {
      setName(""); setCode(""); setUnit("");
      setCostPrice(""); setSalePrice("");
      setStock(""); setLowAlert("");
      setPhotoUri(null);
      setShopId("");
    }
    setError("");
  }, [visible, editing]);

  async function pickPhoto() {
    const options = [
      {
        text: "Выбрать из галереи",
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: "images" as ImagePicker.MediaType,
            allowsEditing: true,
            aspect: [1, 1] as [number, number],
            quality: 0.7,
          });
          if (!result.canceled) setPhotoUri(result.assets[0].uri);
        },
      },
      {
        text: "Сделать фото",
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (perm.status !== "granted") return;
          const result = await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            aspect: [1, 1] as [number, number],
            quality: 0.7,
          });
          if (!result.canceled) setPhotoUri(result.assets[0].uri);
        },
      },
      ...(photoUri
        ? [{ text: "Удалить фото", style: "destructive" as const, onPress: () => setPhotoUri(null) }]
        : []),
      { text: "Отмена", style: "cancel" as const },
    ];
    Alert.alert("Фото товара", "Выберите действие", options);
  }

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите название товара."); return; }
    if (!costPrice || isNaN(Number(costPrice))) { setError("Некорректная цена закупки."); return; }
    if (!salePrice || isNaN(Number(salePrice))) { setError("Некорректная цена продажи."); return; }
    if (!stock || isNaN(Number(stock))) { setError("Некорректное количество."); return; }
    if (isSuperAdmin && !editing && !shopId) { setError("Выберите магазин."); return; }

    setSubmitting(true);
    try {
      const payload: CreateProductPayload = {
        name: name.trim(),
        cost_price: parseFloat(costPrice),
        sale_price: parseFloat(salePrice),
        stock_quantity: parseFloat(stock),
      };
      if (code.trim()) payload.code = code.trim();
      if (unit.trim()) payload.unit = unit.trim();
      if (lowAlert.trim() && !isNaN(Number(lowAlert)))
        payload.low_stock_alert = parseFloat(lowAlert);
      if (isSuperAdmin && shopId && !editing) {
        payload.shop_id = parseInt(shopId, 10);
      }

      // Only send photoUri if it's a new local file (not an existing remote URL)
      const isNewPhoto = photoUri && !photoUri.startsWith("http");

      const saved = editing
        ? await api.products.update(editing.id, payload, token, isNewPhoto ? photoUri : undefined)
        : await api.products.create(payload, token, photoUri ?? undefined);
      onSaved(saved, !!editing);
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Что-то пошло не так. Попробуйте снова."
      );
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
        {/* Header */}
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">
            {editing ? "Изменить товар" : "Добавить товар"}
          </Text>
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
              {isSuperAdmin && !editing && (
                <Select
                  label="Магазин"
                  required
                  value={shopId}
                  onValueChange={setShopId}
                  options={shops.map(s => ({ label: s.name, value: String(s.id) }))}
                  placeholder="Выберите магазин"
                />
              )}
              {/* Photo picker */}
              <TouchableOpacity
                onPress={pickPhoto}
                className="self-center w-28 h-28 rounded-2xl bg-slate-100 dark:bg-zinc-800 items-center justify-center overflow-hidden border-2 border-dashed border-slate-300 dark:border-zinc-600"
              >
                {photoUri ? (
                  <>
                    <Image
                      source={{ uri: photoUri }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                    />
                    <TouchableOpacity
                      onPress={() => setPhotoUri(null)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 items-center justify-center"
                      hitSlop={8}
                    >
                      <MaterialIcons name="close" size={14} color="#fff" />
                    </TouchableOpacity>
                  </>
                ) : (
                  <View className="items-center gap-1">
                    <MaterialIcons name="add-a-photo" size={28} color="#94a3b8" />
                    <Text className="text-xs text-slate-400">Фото</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Input
                label="Название товара"
                required
                placeholder="напр. Беспроводная мышь"
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                onSubmitEditing={() => codeRef.current?.focus()}
              />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    ref={codeRef}
                    label="Код / Артикул"
                    placeholder="напр. WM-001"
                    value={code}
                    onChangeText={setCode}
                    returnKeyType="next"
                    onSubmitEditing={() => unitRef.current?.focus()}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    ref={unitRef}
                    label="Ед. изм."
                    placeholder="напр. шт"
                    value={unit}
                    onChangeText={setUnit}
                    returnKeyType="next"
                    onSubmitEditing={() => costRef.current?.focus()}
                  />
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    ref={costRef}
                    label="Цена закупки"
                    required
                    placeholder="0"
                    value={costPrice}
                    onChangeText={setCostPrice}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => saleRef.current?.focus()}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    ref={saleRef}
                    label="Цена продажи"
                    required
                    placeholder="0"
                    value={salePrice}
                    onChangeText={setSalePrice}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => stockRef.current?.focus()}
                  />
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    ref={stockRef}
                    label="Количество"
                    required
                    placeholder="0"
                    value={stock}
                    onChangeText={setStock}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => alertRef.current?.focus()}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    ref={alertRef}
                    label="Порог остатка"
                    placeholder="напр. 5"
                    value={lowAlert}
                    onChangeText={setLowAlert}
                    keyboardType="numeric"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                </View>
              </View>
            </View>

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              {editing ? "Сохранить" : "Добавить товар"}
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
