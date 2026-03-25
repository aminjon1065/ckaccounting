import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge, Button, Input, Select, Skeleton, Text } from "@/components/ui";
import {
  api,
  ApiError,
  type CreateProductPayload,
  type Product,
  type Shop,
} from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function stockColor(p: Product) {
  if (p.stock_quantity === 0) return "text-red-500";
  if (p.low_stock_alert != null && p.stock_quantity <= p.low_stock_alert)
    return "text-amber-500";
  return "text-green-600";
}

// ─── Product card ─────────────────────────────────────────────────────────────

function ProductCard({
  item,
  onViewDetail,
  onEdit,
  onDelete,
  canEdit,
}: {
  item: Product;
  onViewDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  const isLow =
    item.low_stock_alert != null && item.stock_quantity <= item.low_stock_alert;
  const isOut = item.stock_quantity === 0;

  return (
    <TouchableOpacity
      onPress={onViewDetail}
      onLongPress={
        canEdit
          ? () =>
              Alert.alert(item.name, "Выберите действие", [
                { text: "Изменить", onPress: onEdit },
                { text: "Удалить", style: "destructive", onPress: onDelete },
                { text: "Отмена", style: "cancel" },
              ])
          : undefined
      }
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 shadow-sm border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      {/* Top row */}
      <View className="flex-row items-center gap-3 mb-2">
        {/* Thumbnail */}
        {item.photo_url ? (
          <Image
            source={{ uri: item.photo_url }}
            style={{ width: 52, height: 52, borderRadius: 10 }}
            contentFit="cover"
          />
        ) : (
          <View className="w-13 h-13 rounded-xl bg-slate-100 dark:bg-zinc-800 items-center justify-center">
            <MaterialIcons name="inventory-2" size={22} color="#94a3b8" />
          </View>
        )}
        {/* Name + meta */}
        <View className="flex-1">
          <View className="flex-row items-start justify-between">
            <Text className="text-base font-semibold text-slate-900 dark:text-slate-50 flex-1 mr-2">
              {item.name}
            </Text>
            {isOut ? (
              <Badge variant="destructive">Нет в наличии</Badge>
            ) : isLow ? (
              <Badge variant="warning">Мало</Badge>
            ) : null}
          </View>
          <Text variant="small">
            {[item.code, item.unit].filter(Boolean).join(" · ") || "—"}
          </Text>
        </View>
      </View>

      {/* Prices row */}
      <View className="flex-row gap-4">
        <View>
          <Text variant="small">Закупка</Text>
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {fmt(item.cost_price)}
          </Text>
        </View>
        <View>
          <Text variant="small">Продажа</Text>
          <Text className="text-sm font-semibold text-primary-500">
            {fmt(item.sale_price)}
          </Text>
        </View>
        <View className="flex-1 items-end">
          <Text variant="small">Остаток</Text>
          <Text className={`text-sm font-semibold ${stockColor(item)}`}>
            {item.stock_quantity} {item.unit ?? ""}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Form modal ───────────────────────────────────────────────────────────────

interface FormModalProps {
  visible: boolean;
  editing: Product | null;
  onClose: () => void;
  onSaved: (p: Product, wasEditing: boolean) => void;
  token: string;
  isSuperAdmin: boolean;
}

function ProductFormModal({
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

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const canEdit = can(user?.role, "products:edit");
  const isSuperAdmin = user?.role === "super_admin";

  const [products, setProducts] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const searchDebounce = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [formVisible, setFormVisible] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [error, setError] = React.useState("");

  async function fetchProducts(
    reset = false,
    searchVal = search
  ) {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");
    try {
      const res = await api.products.list(token, {
        page: pg,
        search: searchVal || undefined,
      });
      if (reset) {
        setProducts(res.data);
        setPage(2);
      } else {
        setProducts((prev) => [...prev, ...res.data]);
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e) {
      console.error("Products fetch error:", e);
      if (reset) setError("Не удалось загрузить товары.");
    }
  }

  React.useEffect(() => {
    fetchProducts(true).finally(() => setLoading(false));
  }, [token]);

  function handleRefresh() {
    setRefreshing(true);
    fetchProducts(true).finally(() => setRefreshing(false));
  }

  function handleLoadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    fetchProducts(false).finally(() => setLoadingMore(false));
  }

  function handleSearchChange(text: string) {
    setSearch(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setLoading(true);
      fetchProducts(true, text).finally(() => setLoading(false));
    }, 400);
  }

  function handleDelete(id: number) {
    Alert.alert("Удалить товар", "Товар будет удалён безвозвратно.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await api.products.delete(id, token!);
            setProducts((prev) => prev.filter((p) => p.id !== id));
            showToast({ message: "Товар удалён", variant: "success" });
          } catch (e) {
            showToast({ message: "Не удалось удалить товар.", variant: "error" });
          }
        },
      },
    ]);
  }

  function handleSaved(saved: Product, wasEditing: boolean) {
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    showToast({
      message: wasEditing ? "Товар обновлён" : "Товар добавлен",
      variant: "success",
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <Text variant="h4">Товары</Text>
        <Text variant="muted" className="mt-0.5">
          Управление складом
        </Text>
      </View>

      {/* Search bar */}
      <View className="px-4 py-3 bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800">
        <View className="flex-row items-center bg-slate-100 dark:bg-zinc-800 rounded-xl px-3 gap-2">
          <MaterialIcons name="search" size={18} color="#94a3b8" />
          <RNTextInput
            value={search}
            onChangeText={handleSearchChange}
            placeholder="Поиск товаров…"
            placeholderTextColor="#94a3b8"
            className="flex-1 py-2.5 text-sm text-slate-900 dark:text-slate-50"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <View key={i} className="mb-3">
              <Skeleton className="h-24 rounded-2xl" />
            </View>
          ))}
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="cloud-off" size={48} color="#94a3b8" />
          <Text variant="h5" className="mt-4 text-center">Ошибка загрузки</Text>
          <Text variant="muted" className="mt-1 text-center">{error}</Text>
          <TouchableOpacity
            onPress={() => { setLoading(true); fetchProducts(true).finally(() => setLoading(false)); }}
            className="mt-4 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl"
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-20">
              <MaterialIcons name="inventory-2" size={48} color="#94a3b8" />
              <Text variant="muted" className="mt-3 text-center">
                {search ? "Товары не найдены." : "Нет товаров.\nНажмите + для добавления."}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                size="small"
                color="#0a7ea4"
                style={{ marginVertical: 16 }}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <ProductCard
              item={item}
              onViewDetail={() => router.push(`/products/${item.id}`)}
              onEdit={() => {
                setEditing(item);
                setFormVisible(true);
              }}
              onDelete={() => handleDelete(item.id)}
              canEdit={canEdit}
            />
          )}
        />
      )}

      {/* FAB */}
      {canEdit && (
        <TouchableOpacity
          onPress={() => {
            setEditing(null);
            setFormVisible(true);
          }}
          className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg active:opacity-80"
          style={{ elevation: 6 }}
        >
          <MaterialIcons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Form modal */}
      <ProductFormModal
        visible={formVisible}
        editing={editing}
        onClose={() => setFormVisible(false)}
        onSaved={(saved, wasEditing) => handleSaved(saved, wasEditing)}
        token={token!}
        isSuperAdmin={isSuperAdmin}
      />
    </SafeAreaView>
  );
}
