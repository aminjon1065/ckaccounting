import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as React from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Image, type ImageSource } from "expo-image";
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
import { getLocalShops } from "@/lib/db";
import {
  finishSystemUiBiometricSuppression,
  suppressBiometricRelockForSystemUi,
} from "@/lib/biometricRelock";
import { effectiveShopId, needsShopPicker, pickerShopIds } from "@/lib/permissions";
import { parseDecimal } from "@/lib/formatters";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";
import { useCreateProduct, useUpdateProduct } from "@/lib/queries/products";

interface FormModalProps {
  visible: boolean;
  editing: Product | null;
  /**
   * Optional seed for the name field when opening for a fresh create.
   * Used by inline-create flows (e.g. the purchase product picker passes
   * the user's search string so they don't retype it).
   */
  initialName?: string;
  /**
   * When set, lock the product's shop to this id and hide the shop picker.
   * Used by inline-create flows inside purchase / sale modals — the parent
   * has already chosen the target shop, and letting the user pick a
   * different one here causes the backend to reject the parent submission
   * with "Resource not Found" (the purchase shop won't see a product from
   * another shop).
   */
  initialShopId?: number | null;
  onClose: () => void;
  /** Optional — list / detail caches are invalidated by the mutation
   *  hooks. Provide only when the caller needs post-save side effects
   *  (e.g. close + navigate). */
  onSaved?: (p: Product, wasEditing: boolean) => void;
  /**
   * Server reported the product no longer exists during an edit (404). The
   * caller should evict the local row and refresh the list. Only fires for
   * the edit path — create can't 404 on the entity itself.
   */
  onMissing?: (id: string) => void;
  token: string;
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

const PRODUCT_PHOTO_DIR = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ""}product-photos/`;

function inferPhotoExtension(uri: string, fileName?: string | null) {
  const source = fileName ?? uri;
  const match = source.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = match?.[1]?.toLowerCase();
  if (!ext || ext.length > 5) {
    return "jpg";
  }
  return ext;
}

async function persistProductPhoto(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const sourceUri = asset.uri;
  if (!sourceUri) {
    throw new Error("Не удалось получить путь к фото.");
  }

  if (/^https?:\/\//i.test(sourceUri)) {
    return sourceUri;
  }

  if (!PRODUCT_PHOTO_DIR) {
    return sourceUri;
  }

  await FileSystem.makeDirectoryAsync(PRODUCT_PHOTO_DIR, { intermediates: true });

  const extension = inferPhotoExtension(sourceUri, asset.fileName);
  const destinationUri = `${PRODUCT_PHOTO_DIR}${generateUUID()}.${extension}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destinationUri });

  return destinationUri;
}

export function ProductFormModal({
  visible,
  editing,
  initialName,
  initialShopId,
  onClose,
  onSaved,
  onMissing,
  token,
}: FormModalProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  // Shop scope:
  //   • `initialShopId` (set by inline-create callers like the purchase /
  //     sale modal) wins — we're a sub-flow of an already shop-scoped
  //     parent. The picker stays hidden so the user can't accidentally
  //     pick another shop and break the parent submission.
  //   • Otherwise: standalone create flow. Show the picker for
  //     super_admin / multi-shop owners; single-shop users get the
  //     implicit shop without a picker.
  const lockedShopId = initialShopId ?? null;
  const showShopPicker = lockedShopId === null && needsShopPicker(user);
  const implicitShopId = lockedShopId ?? effectiveShopId(user);
  const allowedShopIds = React.useMemo(() => pickerShopIds(user), [user]);
  const [shopId, setShopId] = React.useState<string>("");
  const [shops, setShops] = React.useState<Shop[]>([]);

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
  const createMutation = useCreateProduct(token);
  const updateMutation = useUpdateProduct(token);
  const submitting = createMutation.isPending || updateMutation.isPending;
  const [codeScannerVisible, setCodeScannerVisible] = React.useState(false);

  const codeRef = React.useRef<RNTextInput>(null);
  const unitRef = React.useRef<RNTextInput>(null);
  const costRef = React.useRef<RNTextInput>(null);
  const saleRef = React.useRef<RNTextInput>(null);
  const stockRef = React.useRef<RNTextInput>(null);
  const alertRef = React.useRef<RNTextInput>(null);

  React.useEffect(() => {
    if (!visible || !showShopPicker) return;

    const filterAllowed = <T extends { id: number }>(list: T[]): T[] =>
      allowedShopIds == null ? list : list.filter((s) => allowedShopIds.includes(s.id));

    // Load local shops immediately so the picker works offline
    getLocalShops().then(local => {
      if (local.length > 0) {
        const mapped = local.map(s => ({ id: s.id, name: s.name } as Shop));
        setShops(filterAllowed(mapped));
      }
    }).catch(() => {});

    // Refresh from server in background; update if we get a better list.
    api.shops.list(token).then((res) => {
      if (res.data && res.data.length > 0) setShops(filterAllowed(res.data));
    }).catch(() => {});
  }, [visible, showShopPicker, token, allowedShopIds]);

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
      setName(initialName ?? "");
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
    // `initialName` is only consumed on the visibility/editing edge — we
    // intentionally omit it from the dep list so a parent re-render that
    // changes the seed mid-edit doesn't clobber what the user has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing]);

  const computedMarkupPrice = pricingMode === "markup"
    ? computeMarkupPrice(costPrice, markupPercent)
    : salePrice;
  const previewSource = React.useMemo<ImageSource | undefined>(() => {
    if (!photoUri) return undefined;
    return { uri: photoUri };
  }, [photoUri]);

  async function pickPhoto() {
    const options = [
      {
        text: "Выбрать из галереи",
        onPress: async () => {
          try {
            suppressBiometricRelockForSystemUi();
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: "images" as ImagePicker.MediaType,
              allowsEditing: true,
              aspect: [1, 1] as [number, number],
              quality: 0.7,
            });

            if (!result.canceled) {
              const persistedUri = await persistProductPhoto(result.assets[0]);
              setPhotoUri(persistedUri);
            }
          } finally {
            finishSystemUiBiometricSuppression();
          }
        },
      },
      {
        text: "Сделать фото",
        onPress: async () => {
          try {
            suppressBiometricRelockForSystemUi();
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
              const persistedUri = await persistProductPhoto(result.assets[0]);
              setPhotoUri(persistedUri);
            }
          } finally {
            finishSystemUiBiometricSuppression();
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

    if (showShopPicker && !editing && !shopId) {
      setError("Выберите магазин.");
      return;
    }
    if (!showShopPicker && !editing && implicitShopId === null) {
      setError("Магазин не назначен.");
      return;
    }

    try {
      // parseDecimal normalises Russian "3,5" → 3.5; plain parseFloat would
      // truncate at the comma and silently store 3.
      const payload: CreateProductPayload = {
        name: name.trim(),
        cost_price: parseDecimal(costPrice),
        pricing_mode: pricingMode,
        stock_quantity: parseDecimal(stock),
      };

      if (pricingMode === "markup") {
        payload.markup_percent = parseDecimal(markupPercent);
        payload.sale_price = parseDecimal(computedMarkupPrice);
      } else {
        payload.sale_price = parseDecimal(salePrice);
      }

      if (bulkPrice.trim()) {
        const v = parseDecimal(bulkPrice);
        if (!Number.isNaN(v)) payload.bulk_price = v;
      }

      if (bulkThreshold.trim()) {
        const v = parseDecimal(bulkThreshold);
        if (!Number.isNaN(v)) payload.bulk_threshold = Math.trunc(v);
      }

      if (code.trim()) {
        payload.code = code.trim();
      }

      if (unit.trim()) {
        payload.unit = unit.trim();
      }

      if (lowAlert.trim()) {
        const v = parseDecimal(lowAlert);
        if (!Number.isNaN(v)) payload.low_stock_alert = v;
      }

      if (!editing) {
        payload.shop_id = showShopPicker && shopId
          ? parseInt(shopId, 10)
          : (implicitShopId ?? undefined);
      }

      const isNewPhoto = photoUri && !photoUri.startsWith("http");

      // Include version for optimistic locking (detect concurrent edits)
      if (editing) {
        payload.version = (editing as Product).version ?? 1;
      }

      const saved = editing
        ? await updateMutation.mutateAsync({
            id: editing.id,
            payload,
            photoUri: isNewPhoto ? (photoUri ?? undefined) : undefined,
          })
        : await createMutation.mutateAsync({
            payload,
            photoUri: photoUri ?? undefined,
          });

      onSaved?.(saved, !!editing);
      showToast({
        message: editing ? "Товар обновлён" : "Товар добавлен",
        variant: "success",
      });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else if (e instanceof ApiError && e.status === 404 && editing && onMissing) {
        // Product was deleted on the server while we still had it cached.
        // The mutation's onError rolled back the optimistic patch.
        onMissing(editing.id);
        onClose();
      } else {
        setError(
          e instanceof ApiError
            ? e.describeErrors()
            : "Что-то пошло не так. Попробуйте снова."
        );
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
              {editing ? "Изменить товар" : "Новый товар"}
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              {editing ? "Сохраните изменения" : "Заполните основные поля"}
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
              {showShopPicker && !editing && (
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
                {previewSource ? (
                  <>
                    <Image
                      source={previewSource}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
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
