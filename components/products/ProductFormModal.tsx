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
import { ScannerOverlay } from "@/components/ScannerOverlay";
import {
  api,
  ApiError,
  type CreateProductPayload,
  type Product,
  type Shop,
} from "@/lib/api";
import { useSync } from "@/lib/sync/SyncContext";
import { getLocalShops, insertOrUpdateProduct } from "@/lib/db";
import type { LocalProduct } from "@/lib/db";

interface FormModalProps {
  visible: boolean;
  editing: Product | null;
  onClose: () => void;
  onSaved: (p: Product, wasEditing: boolean) => void;
  token: string;
  isSuperAdmin: boolean;
}

type PricingMode = "fixed" | "markup" | "manual";

function computeMarkupPrice(costPrice: string, markupPercent: string): string {
  const parsedCost = Number(costPrice);
  const parsedMarkup = Number(markupPercent);

  if (Number.isNaN(parsedCost) || Number.isNaN(parsedMarkup)) {
    return "";
  }

  return (parsedCost * (1 + parsedMarkup / 100)).toFixed(2);
}

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
  const { refreshPendingActions } = useSync();

  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [costPrice, setCostPrice] = React.useState("");
  const [salePrice, setSalePrice] = React.useState("");
  const [pricingMode, setPricingMode] = React.useState<PricingMode>("fixed");
  const [markupPercent, setMarkupPercent] = React.useState("");
  const [bulkPrice, setBulkPrice] = React.useState("");
  const [bulkThreshold, setBulkThreshold] = React.useState("");
  const [stock, setStock] = React.useState("");
  const [lowAlert, setLowAlert] = React.useState("");
  const [photoUri, setPhotoUri] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [codeScannerVisible, setCodeScannerVisible] = React.useState(false);

  const codeRef = React.useRef<RNTextInput>(null);
  const unitRef = React.useRef<RNTextInput>(null);
  const costRef = React.useRef<RNTextInput>(null);
  const saleRef = React.useRef<RNTextInput>(null);
  const stockRef = React.useRef<RNTextInput>(null);
  const alertRef = React.useRef<RNTextInput>(null);

  React.useEffect(() => {
    if (!visible || !isSuperAdmin) return;

    // Load local shops immediately so the picker works offline
    getLocalShops().then(local => {
      if (local.length > 0) setShops(local.map(s => ({ id: s.id, name: s.name } as Shop)));
    }).catch(() => {});

    // Refresh from server in background; update if we get a better list
    api.shops.list(token).then((res: any) => {
      const shopList: Shop[] = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      if (shopList.length > 0) setShops(shopList);
    }).catch(() => {});
  }, [visible, isSuperAdmin, token]);

  React.useEffect(() => {
    if (visible && editing) {
      setName(editing.name);
      setCode(editing.code ?? "");
      setUnit(editing.unit ?? "");
      setCostPrice(String(editing.cost_price));
      setSalePrice(String(editing.sale_price));
      setPricingMode(editing.pricing_mode ?? "fixed");
      setMarkupPercent(editing.markup_percent != null ? String(editing.markup_percent) : "");
      setBulkPrice(editing.bulk_price != null ? String(editing.bulk_price) : "");
      setBulkThreshold(editing.bulk_threshold != null ? String(editing.bulk_threshold) : "");
      setStock(String(editing.stock_quantity));
      setLowAlert(editing.low_stock_alert != null ? String(editing.low_stock_alert) : "");
      setPhotoUri(editing.photo_url ?? editing.image_url ?? null);
      setShopId(editing.shop_id ? String(editing.shop_id) : "");
    } else if (visible && !editing) {
      setName("");
      setCode("");
      setUnit("");
      setCostPrice("");
      setSalePrice("");
      setPricingMode("fixed");
      setMarkupPercent("");
      setBulkPrice("");
      setBulkThreshold("");
      setStock("");
      setLowAlert("");
      setPhotoUri(null);
      setShopId("");
    }

    setError("");
  }, [visible, editing]);

  const computedMarkupPrice = pricingMode === "markup"
    ? computeMarkupPrice(costPrice, markupPercent)
    : salePrice;

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

          if (!result.canceled) {
            setPhotoUri(result.assets[0].uri);
          }
        },
      },
      {
        text: "Сделать фото",
        onPress: async () => {
          const permission = await ImagePicker.requestCameraPermissionsAsync();

          if (permission.status !== "granted") {
            return;
          }

          const result = await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            aspect: [1, 1] as [number, number],
            quality: 0.7,
          });

          if (!result.canceled) {
            setPhotoUri(result.assets[0].uri);
          }
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

    if (!name.trim()) {
      setError("Введите название товара.");
      return;
    }

    if (!costPrice || Number.isNaN(Number(costPrice))) {
      setError("Некорректная цена закупки.");
      return;
    }

    if (pricingMode !== "markup" && (!salePrice || Number.isNaN(Number(salePrice)))) {
      setError("Некорректная цена продажи.");
      return;
    }

    if (pricingMode === "markup" && (!markupPercent || Number.isNaN(Number(markupPercent)))) {
      setError("Укажите наценку в процентах.");
      return;
    }

    if (!stock || Number.isNaN(Number(stock))) {
      setError("Некорректное количество.");
      return;
    }

    if (isSuperAdmin && !editing && !shopId) {
      setError("Выберите магазин.");
      return;
    }

    setSubmitting(true);

    try {
      const payload: CreateProductPayload = {
        name: name.trim(),
        cost_price: parseFloat(costPrice),
        pricing_mode: pricingMode,
        stock_quantity: parseFloat(stock),
      };

      if (pricingMode === "markup") {
        payload.markup_percent = parseFloat(markupPercent);
        payload.sale_price = parseFloat(computedMarkupPrice);
      } else {
        payload.sale_price = parseFloat(salePrice);
      }

      if (bulkPrice.trim() && !Number.isNaN(Number(bulkPrice))) {
        payload.bulk_price = parseFloat(bulkPrice);
      }

      if (bulkThreshold.trim() && !Number.isNaN(Number(bulkThreshold))) {
        payload.bulk_threshold = parseInt(bulkThreshold, 10);
      }

      if (code.trim()) {
        payload.code = code.trim();
      }

      if (unit.trim()) {
        payload.unit = unit.trim();
      }

      if (lowAlert.trim() && !Number.isNaN(Number(lowAlert))) {
        payload.low_stock_alert = parseFloat(lowAlert);
      }

      if (isSuperAdmin && shopId && !editing) {
        payload.shop_id = parseInt(shopId, 10);
      }

      const isNewPhoto = photoUri && !photoUri.startsWith("http");

      const saved = editing
        ? await api.products.update(editing.id, payload, token, isNewPhoto ? photoUri : undefined)
        : await api.products.create(payload, token, photoUri ?? undefined);

      onSaved(saved, !!editing);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // Offline: save locally, queue for sync
        const localId = generateUUID();
        const now = new Date().toISOString();
        const productPayload = {
          id: -Date.now(),
          shop_id: isSuperAdmin && shopId ? parseInt(shopId, 10) : null,
          name: name.trim(),
          code: code.trim() || null,
          unit: unit.trim() || null,
          cost_price: parseFloat(costPrice),
          sale_price: pricingMode === "markup" ? parseFloat(computedMarkupPrice) : parseFloat(salePrice),
          pricing_mode: pricingMode as Product["pricing_mode"],
          markup_percent: pricingMode === "markup" && markupPercent ? parseFloat(markupPercent) : null,
          bulk_price: bulkPrice.trim() ? parseFloat(bulkPrice) : null,
          bulk_threshold: bulkThreshold.trim() ? parseInt(bulkThreshold, 10) : null,
          stock_quantity: parseFloat(stock),
          low_stock_alert: lowAlert.trim() ? parseFloat(lowAlert) : null,
          photo_url: photoUri && !photoUri.startsWith("http") ? photoUri : null,
          created_at: now,
          updated_at: now,
        } as Product;

        await insertOrUpdateProduct(productPayload, localId, editing ? "update" : "create");
        const optimisticProduct: LocalProduct = {
          ...productPayload,
          local_id: localId,
          status: "pending",
          sync_action: editing ? "update" : "create",
        } as LocalProduct;

        onSaved(optimisticProduct as Product, !!editing);
        onClose();
      } else {
        setError(
          e instanceof ApiError
            ? e.message
            : "Что-то пошло не так. Попробуйте снова."
        );
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
                  options={shops.map((shop) => ({ label: shop.name, value: String(shop.id) }))}
                  placeholder="Выберите магазин"
                />
              )}

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
                placeholder="например, Беспроводная мышь"
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                onSubmitEditing={() => codeRef.current?.focus()}
              />

              {/* Code / Unit row with barcode scan button */}
              <View className="flex-row gap-2 items-end">
                <View className="flex-1">
                  <Input
                    ref={codeRef}
                    label="Код / Артикул"
                    placeholder="например, WM-001"
                    value={code}
                    onChangeText={setCode}
                    returnKeyType="next"
                    onSubmitEditing={() => unitRef.current?.focus()}
                  />
                </View>
                <TouchableOpacity
                  onPress={() => setCodeScannerVisible(true)}
                  className="mb-0.5 w-11 h-11 rounded-xl bg-slate-100 dark:bg-zinc-800 items-center justify-center border border-slate-200 dark:border-zinc-700"
                  hitSlop={8}
                >
                  <MaterialIcons name="qr-code-scanner" size={20} color="#64748b" />
                </TouchableOpacity>
                <View className="flex-1">
                  <Input
                    ref={unitRef}
                    label="Ед. изм."
                    placeholder="например, шт"
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
                  <Select
                    label="Режим цены"
                    value={pricingMode}
                    onValueChange={(value) => setPricingMode(value)}
                    options={[
                      { label: "Фиксированная", value: "fixed", description: "Используется sale price" },
                      { label: "Наценка %", value: "markup", description: "Цена считается от закупки" },
                      { label: "Ручная", value: "manual", description: "Цена вводится на кассе" },
                    ]}
                  />
                </View>
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    ref={saleRef}
                    label="Цена продажи"
                    required={pricingMode !== "markup"}
                    placeholder="0"
                    value={pricingMode === "markup" ? computedMarkupPrice : salePrice}
                    onChangeText={setSalePrice}
                    keyboardType="numeric"
                    returnKeyType="next"
                    editable={pricingMode !== "markup"}
                    hint={pricingMode === "manual" ? "Эта цена используется как стартовая, но в POS её можно изменить." : undefined}
                    onSubmitEditing={() => stockRef.current?.focus()}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Наценка %"
                    placeholder="0"
                    value={markupPercent}
                    onChangeText={setMarkupPercent}
                    keyboardType="numeric"
                    editable={pricingMode === "markup"}
                    hint={pricingMode === "markup" ? "Автоматически пересчитывает цену продажи." : undefined}
                  />
                </View>
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    label="Оптовая цена"
                    placeholder="0"
                    value={bulkPrice}
                    onChangeText={setBulkPrice}
                    keyboardType="numeric"
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Порог опта"
                    placeholder="например, 10"
                    value={bulkThreshold}
                    onChangeText={setBulkThreshold}
                    keyboardType="numeric"
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
                    placeholder="например, 5"
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

      {/* Barcode scanner for populating the code field */}
      <ScannerOverlay
        visible={codeScannerVisible}
        onClose={() => setCodeScannerVisible(false)}
        onScan={(scannedCode) => {
          setCode(scannedCode);
          setCodeScannerVisible(false);
        }}
      />
    </Modal>
  );
}
