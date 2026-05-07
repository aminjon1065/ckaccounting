import * as React from "react";
import * as Crypto from "expo-crypto";
import { Modal, TouchableOpacity, View, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text, Button, Input, Select } from "@/components/ui";
import { api, ApiError, type CreateSalePayload, type Product, type Sale, type SaleType, type Shop } from "@/lib/api";
import { useSyncMethods } from "@/lib/sync/SyncContext";
import { useAuth } from "@/store/auth";
import { ProductPicker } from "./ProductPicker";
import { ScannerOverlay } from "@/components/ScannerOverlay";
import { defaultPriceMode, deriveProductPrice, fmt, PAYMENT_ICONS, PAYMENT_LABELS } from "./helpers";
import { PriceMode, CartItem, ServiceLineItem } from "./types";
import { CartRow } from "./CartRow";
import { ServiceItemRow } from "./ServiceItemRow";
import { getLocalProducts, insertOrUpdateProducts, insertOrUpdateSale, decrementLocalProductStock, insertNotification, hasLowStockAlertBeenSent, markLowStockAlertSent, getLocalProductById, localScope } from "@/lib/db";
import { useToast } from "@/store/toast";
import { reportError } from "@/lib/observability/reporter";
import { effectiveShopId, needsShopPicker } from "@/lib/permissions";

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function CreateSaleModal({
  visible,
  onClose,
  onCreated,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (s: Sale) => void;
  token: string;
}) {
  const { user } = useAuth();
  // Multi-shop UX: super_admin and multi-shop owners pick a shop in the
  // form; sellers and single-shop owners get an implicit shop and no
  // picker.
  const showShopPicker = needsShopPicker(user);
  const implicitShopId = effectiveShopId(user);
  const canEditPrice = user?.role !== "seller";
  const [saleType, setSaleType] = React.useState<SaleType>("product");
  const { showToast } = useToast();
  const { refreshPendingActions } = useSyncMethods();

  const [shopId, setShopId] = React.useState<string>("");
  const [shops, setShops] = React.useState<Shop[]>([]);

  // Product sale state
  const [products, setProducts] = React.useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = React.useState(false);
  const [cart, setCart] = React.useState<CartItem[]>([]);
  const [pickerVisible, setPickerVisible] = React.useState(false);

  // Service sale state
  const [serviceItems, setServiceItems] = React.useState<ServiceLineItem[]>([]);
  const serviceIdRef = React.useRef(0);

  // Shared state
  const [customerName, setCustomerName] = React.useState("");
  const [discount, setDiscount] = React.useState("");
  const [paid, setPaid] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [paymentType, setPaymentType] = React.useState<"cash" | "card" | "transfer">("cash");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [scannerVisible, setScannerVisible] = React.useState(false);
  const [productsHasMore, setProductsHasMore] = React.useState(false);
  const [productsNextCursor, setProductsNextCursor] = React.useState<string | null>(null);

  // Load shops when a picker is needed. Server-side scoping ensures
  // owners get only their owned shops, super_admin gets the full list.
  React.useEffect(() => {
    if (visible && showShopPicker) {
      api.shops.list(token)
        .then((res) => setShops(res.data ?? []))
        .catch((e) => reportError(e, { tag: "sale-modal-shops-load" }));
    }
  }, [visible, showShopPicker, token]);

  const loadProductsForSale = React.useCallback(async (selectedShopId?: number, cursor?: string) => {
    setProductsLoading(true);
    // SuperAdmin uses the explicit shop selector; everyone else is bound to
    // their own shop. localScope(user, selectedShopId) handles both paths.
    const scope = localScope(user, selectedShopId ?? null);
    // Show cached results immediately so the picker is never empty when a cache exists.
    if (!cursor) {
      const localProducts = await getLocalProducts(scope);
      setProducts(localProducts);
    }

    try {
      const remoteProducts = await api.products.list(token, {
        limit: 100,
        shop_id: selectedShopId,
        cursor: cursor ?? undefined,
      });
      await insertOrUpdateProducts(remoteProducts.data, selectedShopId);
      const refreshedLocalProducts = await getLocalProducts(scope);
      const newProducts = refreshedLocalProducts.length > 0 ? refreshedLocalProducts : remoteProducts.data;
      if (cursor) {
        setProducts((prev) => [...prev, ...newProducts]);
      } else {
        setProducts(newProducts);
      }
      setProductsNextCursor(remoteProducts.next_cursor ?? null);
      setProductsHasMore(!!remoteProducts.next_cursor);
    } catch (e) {
      // Offline / network failure is expected here — fall back silently to local cache.
      // Only report unexpected (non-network) failures.
      if (e instanceof ApiError && e.status !== 0) {
        reportError(e, { tag: "sale-modal-products-load", shopId: selectedShopId ?? null });
      }
    } finally {
      setProductsLoading(false);
    }
  }, [token]);

  const loadMoreProducts = React.useCallback(() => {
    if (!productsHasMore || productsLoading) return;
    loadProductsForSale(undefined, productsNextCursor ?? undefined);
  }, [productsHasMore, productsNextCursor, productsLoading, loadProductsForSale]);

  // Reset form state on each open
  React.useEffect(() => {
    if (!visible) return;
    setSaleType("product");
    setCart([]); setServiceItems([]);
    setCustomerName(""); setDiscount("");
    setPaid(""); setNotes("");
    setPaymentType("cash"); setError("");
    serviceIdRef.current = 0;
    setShopId("");
  }, [visible]);

  // Effective shop = picker selection (when picker is shown) OR the user's
  // implicit shop (seller / single-shop owner). null when picker is shown
  // but nothing picked yet — products list stays empty until a choice.
  const activeShopId: number | null = showShopPicker
    ? (shopId ? Number(shopId) : null)
    : implicitShopId;

  React.useEffect(() => {
    if (!visible) return;
    if (showShopPicker && activeShopId === null) {
      // Picker visible but nothing picked yet — clear list, await selection.
      setProducts([]);
      setCart([]);
      return;
    }
    loadProductsForSale(activeShopId ?? undefined).catch((e) =>
      reportError(e, { tag: "sale-modal-products-effect", shopId: activeShopId })
    );
  }, [visible, showShopPicker, activeShopId, loadProductsForSale]);

  // ── Product cart helpers ────────────────────────────────────────────────────

  // Stable so the memoized ProductPicker / CartRow don't see a new function
  // identity on each parent render. Functional setState lets us keep deps
  // empty (no need to read current cart).
  const addToCart = React.useCallback((p: Product) => {
    const availableQty = p.stock_quantity ?? 0;
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === p.id);
      if (existing) {
        const newQty = existing.quantity + 1;
        if (newQty > availableQty) {
          showToast({ message: `Нет столько на складе (доступно: ${availableQty})`, variant: "warning" });
          return prev;
        }
        return prev.map((c) => {
          if (c.product.id !== p.id) {
            return c;
          }

          const quantity = c.quantity + 1;

          return {
            ...c,
            quantity,
            quantityInput: String(quantity),
            price: c.priceMode === "manual"
              ? c.price
              : deriveProductPrice(c.product, c.priceMode, c.markupPercent, quantity),
          };
        });
      }

      if (availableQty < 1) {
        showToast({ message: `Нет в наличии`, variant: "warning" });
        return prev;
      }

      const priceMode = defaultPriceMode(p);
      const markupPercent = priceMode === "markup" && p.markup_percent != null
        ? String(p.markup_percent)
        : "";

      return [
        ...prev,
        {
          product: p,
          quantity: 1,
          quantityInput: "1",
          price: deriveProductPrice(p, priceMode, markupPercent, 1),
          priceMode,
          markupPercent,
        },
      ];
    });
  }, [showToast]);

  const handlePickerClose = React.useCallback(() => {
    setPickerVisible(false);
  }, []);

  // Handlers below are intentionally `useCallback`-stable (empty / minimal
  // deps) so the memoized CartRow / ServiceItemRow components can rely on
  // referential equality and skip re-rendering siblings on each keystroke.
  // All updates use functional setState so the closures don't need to read
  // current state and can therefore have empty dep arrays.

  const updateCartQuantity = React.useCallback((productId: string, rawQuantity: string) => {
    const normalized = rawQuantity.replace(",", ".").trim();
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.id !== productId) {
          return c;
        }

        const parsedQuantity = Number(normalized);
        if (!normalized) {
          return { ...c, quantityInput: "" };
        }

        if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
          return { ...c, quantityInput: rawQuantity };
        }

        const availableQty = c.product.stock_quantity ?? 0;
        const quantity = Math.min(parsedQuantity, availableQty);
        if (parsedQuantity > availableQty) {
          showToast({ message: `Нет столько на складе (доступно: ${availableQty})`, variant: "warning" });
        }

        return {
          ...c,
          quantityInput: String(quantity <= 0 ? 1 : quantity),
          quantity: quantity <= 0 ? 1 : quantity,
          price: c.priceMode === "manual"
            ? c.price
            : deriveProductPrice(c.product, c.priceMode, c.markupPercent, quantity <= 0 ? 1 : quantity),
        };
      })
    );
  }, [showToast]);

  const finalizeCartQuantity = React.useCallback((productId: string) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.id !== productId) return c;
        const normalized = (c.quantityInput ?? "").replace(",", ".").trim();
        if (!normalized) {
          return { ...c, quantityInput: String(c.quantity) };
        }

        const parsedQuantity = Number(normalized);
        if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
          return { ...c, quantityInput: String(c.quantity) };
        }

        const availableQty = c.product.stock_quantity ?? 0;
        const quantity = Math.max(1, Math.min(parsedQuantity, availableQty));
        return {
          ...c,
          quantity,
          quantityInput: String(quantity),
          price: c.priceMode === "manual"
            ? c.price
            : deriveProductPrice(c.product, c.priceMode, c.markupPercent, quantity),
        };
      })
    );
  }, []);

  const updatePrice = React.useCallback((productId: string, price: string) => {
    setCart((prev) =>
      prev.map((c) =>
        c.product.id === productId
          ? { ...c, price: isNaN(Number(price)) ? c.price : Number(price) }
          : c
      )
    );
  }, []);

  const updatePriceMode = React.useCallback((productId: string, mode: PriceMode) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.id !== productId) return c;
        const nextMarkupPercent = mode === "markup"
          ? (c.markupPercent || (c.product.markup_percent != null ? String(c.product.markup_percent) : ""))
          : c.markupPercent;
        const price = mode === "manual"
          ? c.price
          : deriveProductPrice(c.product, mode, nextMarkupPercent, c.quantity);

        return { ...c, priceMode: mode, markupPercent: nextMarkupPercent, price };
      })
    );
  }, []);

  const updateMarkup = React.useCallback((productId: string, markup: string) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.id !== productId) return c;
        const price = markup && !isNaN(Number(markup))
          ? deriveProductPrice(c.product, "markup", markup, c.quantity)
          : c.price;
        return { ...c, markupPercent: markup, price };
      })
    );
  }, []);

  const removeCartItem = React.useCallback((productId: string) => {
    setCart((prev) => prev.filter((c) => c.product.id !== productId));
  }, []);

  // ── Service item helpers ────────────────────────────────────────────────────

  const addServiceItem = React.useCallback(() => {
    const id = String(serviceIdRef.current++);
    setServiceItems((prev) => [
      ...prev,
      { id, name: "", unit: "шт", quantity: 1, quantityInput: "1", price: "" },
    ]);
  }, []);

  const updateServiceItem = React.useCallback((id: string, patch: Partial<ServiceLineItem>) => {
    setServiceItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const removeServiceItem = React.useCallback((id: string) => {
    setServiceItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const updateServiceQuantity = React.useCallback((id: string, rawQuantity: string) => {
    const normalized = rawQuantity.replace(",", ".").trim();
    setServiceItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const parsedQuantity = Number(normalized);
        if (!normalized) {
          return { ...item, quantityInput: "" };
        }
        if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
          return { ...item, quantityInput: rawQuantity };
        }
        return { ...item, quantity: parsedQuantity, quantityInput: rawQuantity };
      })
    );
  }, []);

  const finalizeServiceQuantity = React.useCallback((id: string) => {
    setServiceItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const normalized = (item.quantityInput ?? "").replace(",", ".").trim();
        if (!normalized) {
          return { ...item, quantityInput: String(item.quantity) };
        }
        const parsedQuantity = Number(normalized);
        if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
          return { ...item, quantityInput: String(item.quantity) };
        }
        return { ...item, quantity: parsedQuantity, quantityInput: String(parsedQuantity) };
      })
    );
  }, []);

  // ── Calculations ────────────────────────────────────────────────────────────

  const subtotal =
    saleType === "product"
      ? cart.reduce((s, c) => s + c.price * c.quantity, 0)
      : serviceItems.reduce((s, i) => s + (parseFloat(i.price) || 0) * i.quantity, 0);
  const discountVal = parseFloat(discount) || 0;
  const total = Math.max(0, subtotal - discountVal);
  const paidVal = parseFloat(paid) || 0;
  const debt = Math.max(0, total - paidVal);

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setError("");

    if (showShopPicker && !shopId) { setError("Выберите магазин."); return; }
    if (!showShopPicker && implicitShopId === null) { setError("Магазин не назначен."); return; }

    if (saleType === "product") {
      if (cart.length === 0) { setError("Добавьте хотя бы один товар."); return; }
    } else {
      if (serviceItems.length === 0) { setError("Добавьте хотя бы одну услугу."); return; }
      if (serviceItems.some((i) => !i.name.trim())) {
        setError("Укажите название каждой услуги."); return;
      }
    }

    // Validate Seller cannot sell below sale_price
    if (user?.role === "seller" && saleType === "product") {
      for (const c of cart) {
        if (c.price < (c.product.sale_price ?? 0)) {
          setError(`Цена "${c.product.name}" ниже прайса (${c.product.sale_price})`);
          return;
        }
      }
    }

    const payload: CreateSalePayload = {
      type: saleType,
      payment_type: paymentType,
      items:
        saleType === "product"
          ? cart.map((c) => ({
              product_id: c.product.id,
              quantity: c.quantity,
              price: c.price,
            }))
          : serviceItems.map((s) => ({
              name: s.name.trim(),
              unit: s.unit.trim() || undefined,
              quantity: s.quantity,
              price: parseFloat(s.price) || 0,
            })),
      shop_id: showShopPicker && shopId ? Number(shopId) : (implicitShopId ?? undefined),
    };
    if (customerName.trim()) payload.customer_name = customerName.trim();
    if (discountVal > 0) payload.discount = discountVal;
    if (paidVal > 0) payload.paid = paidVal;
    if (notes.trim()) payload.notes = notes.trim();

    setSubmitting(true);
    const bytes = await Crypto.getRandomBytesAsync(16);
    const idempotencyKey = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    try {
      const created = await api.sales.create(payload, token, idempotencyKey);
      // Check low stock for sold products (online case)
      if (saleType === "product") {
        for (const c of cart) {
          const prod = await api.products.get(c.product.id, token).catch(() => null);
          if (prod && prod.low_stock_alert && prod.low_stock_alert > 0) {
            if (prod.stock_quantity <= prod.low_stock_alert) {
              const shopIdForAlert = (showShopPicker && shopId ? Number(shopId) : implicitShopId) ?? 0;
              const alreadySent = await hasLowStockAlertBeenSent(c.product.id, shopIdForAlert);
              if (!alreadySent) {
                await insertNotification(
                  "low_stock",
                  `Мало товара: ${c.product.name}`,
                  `Остаток ${prod.stock_quantity} ${c.product.unit ?? "шт"} при минимуме ${prod.low_stock_alert}`,
                  { product_id: c.product.id, shop_id: shopIdForAlert }
                );
                await markLowStockAlertSent(c.product.id, shopIdForAlert);
              }
            }
          }
        }
      }
      onCreated(created);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        const now = new Date().toISOString();
        const shopIdForSale = (showShopPicker && shopId ? Number(shopId) : implicitShopId) ?? 0;
        const localSale: Sale = {
          id: generateUUID(),
          type: saleType,
          customer_name: customerName.trim() || null,
          total,
          discount: discountVal,
          paid: paidVal,
          debt,
          payment_type: paymentType,
          notes: notes.trim() || undefined,
          items: saleType === "product"
            ? cart.map((c) => ({
                id: generateUUID(),
                product_id: c.product.id,
                name: null,
                product_name: c.product.name,
                unit: c.product.unit ?? undefined,
                quantity: c.quantity,
                price: c.price,
                total: c.price * c.quantity,
              }))
            : serviceItems.map((s) => ({
                id: generateUUID(),
                product_id: null,
                name: null,
                product_name: null,
                service_name: s.name.trim(),
                unit: s.unit.trim() || undefined,
                quantity: s.quantity,
                price: parseFloat(s.price) || 0,
                total: (parseFloat(s.price) || 0) * s.quantity,
              })),
          created_at: now,
          updated_at: now,
        };

        // Save locally and decrement stock immediately
        await insertOrUpdateSale(localSale, shopIdForSale, user?.id);
        for (const c of cart) {
          await decrementLocalProductStock(c.product.id, c.quantity);
          // Check low stock and notify
          const updatedProduct = await getLocalProductById(c.product.id);
          if (updatedProduct && updatedProduct.low_stock_alert && updatedProduct.low_stock_alert > 0) {
            if (updatedProduct.stock_quantity <= updatedProduct.low_stock_alert) {
              const alreadySent = await hasLowStockAlertBeenSent(c.product.id, shopIdForSale);
              if (!alreadySent) {
                await insertNotification(
                  "low_stock",
                  `Мало товара: ${c.product.name}`,
                  `Остаток ${updatedProduct.stock_quantity} ${c.product.unit ?? "шт"} при минимуме ${updatedProduct.low_stock_alert}`,
                  { product_id: c.product.id, shop_id: shopIdForSale }
                );
                await markLowStockAlertSent(c.product.id, shopIdForSale);
              }
            }
          }
        }
        await refreshPendingActions();
        showToast({ message: "Нет сети. Продажа сохранена локально.", variant: "warning" });
        onCreated(localSale);
        onClose();
      } else {
        setError(e instanceof ApiError ? e.message : "Что-то пошло не так.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

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
            Новая продажа
          </Text>
          <View style={{ width: 22 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <ScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Error */}
            {!!error && (
              <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
                <MaterialIcons name="error-outline" size={16} color="#ef4444" />
                <Text className="text-sm text-red-600 flex-1">{error}</Text>
              </View>
            )}

            {/* ── Shop selector ── */}
            {/* Shown for super_admin (any shop) and multi-shop owners (their */}
            {/* owned shops only — server-side scoping in api.shops.list).    */}
            {showShopPicker && (
              <View className="mb-4">
                <Select
                  label="Магазин"
                  required
                  value={shopId}
                  onValueChange={setShopId}
                  options={shops.map(s => ({ label: s.name, value: String(s.id) }))}
                  placeholder="Выберите магазин"
                />
              </View>
            )}

            {/* ── Sale type toggle ─────────────────────────────────────────── */}
            <View className="flex-row bg-slate-100 dark:bg-zinc-800 rounded-xl p-1 mb-5">
              {(["product", "service"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setSaleType(t)}
                  className={`flex-1 flex-row items-center justify-center gap-2 py-2.5 rounded-lg ${
                    saleType === t
                      ? "bg-white dark:bg-zinc-900"
                      : ""
                  }`}
                >
                  <MaterialIcons
                    name={t === "product" ? "inventory-2" : "handyman"}
                    size={16}
                    color={saleType === t ? "#0a7ea4" : "#94a3b8"}
                  />
                  <Text
                    className={`text-sm font-semibold ${
                      saleType === t
                        ? "text-primary-500"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {t === "product" ? "Товары" : "Услуги"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Customer */}
            <Input
              label="Покупатель"
              placeholder="Необязательно"
              value={customerName}
              onChangeText={setCustomerName}
              className="mb-4"
            />

            {/* ── Product cart ─────────────────────────────────────────────── */}
            {saleType === "product" && (
              <>
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    Товары ({cart.length})
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <TouchableOpacity
                      onPress={() => {
                        if (showShopPicker && !shopId) { setError("Сначала выберите магазин."); return; }
                        setScannerVisible(true);
                      }}
                      className="flex-row items-center gap-1 bg-slate-100 dark:bg-zinc-800 px-3 py-1.5 rounded-lg"
                    >
                      <MaterialIcons name="qr-code-scanner" size={16} color="#64748b" />
                      <Text className="text-xs font-semibold text-slate-600 dark:text-slate-400">Скан</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        if (showShopPicker && !shopId) { setError("Сначала выберите магазин для просмотра товаров."); return; }
                        setPickerVisible(true);
                      }}
                      className="flex-row items-center gap-1 bg-primary-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg"
                    >
                      <MaterialIcons name="add" size={16} color="#0a7ea4" />
                      <Text className="text-xs font-semibold text-primary-500">
                        Добавить товар
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {cart.length === 0 ? (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-6 items-center mb-4">
                    <MaterialIcons name="shopping-cart" size={32} color="#94a3b8" />
                    <Text variant="muted" className="mt-2 text-center text-sm">
                      {productsLoading ? "Загрузка товаров..." : "Нет товаров"}
                    </Text>
                  </View>
                ) : (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl mb-4 overflow-hidden">
                    {cart.map((c) => (
                      <CartRow
                        key={c.product.id}
                        item={c}
                        canEditPrice={canEditPrice}
                        onRemove={removeCartItem}
                        onPriceModeChange={updatePriceMode}
                        onQuantityChange={updateCartQuantity}
                        onQuantityBlur={finalizeCartQuantity}
                        onMarkupChange={updateMarkup}
                        onPriceChange={updatePrice}
                      />
                    ))}
                  </View>
                )}
              </>
            )}

            {/* ── Service items ────────────────────────────────────────────── */}
            {saleType === "service" && (
              <>
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    Услуги ({serviceItems.length})
                  </Text>
                  <TouchableOpacity
                    onPress={addServiceItem}
                    className="flex-row items-center gap-1 bg-primary-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg"
                  >
                    <MaterialIcons name="add" size={16} color="#0a7ea4" />
                    <Text className="text-xs font-semibold text-primary-500">
                      Добавить
                    </Text>
                  </TouchableOpacity>
                </View>

                {serviceItems.length === 0 ? (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-6 items-center mb-4">
                    <MaterialIcons name="handyman" size={32} color="#94a3b8" />
                    <Text variant="muted" className="mt-2 text-center text-sm">
                      Нет услуг
                    </Text>
                  </View>
                ) : (
                  <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl mb-4 overflow-hidden">
                    {serviceItems.map((item) => (
                      <ServiceItemRow
                        key={item.id}
                        item={item}
                        onPatch={updateServiceItem}
                        onRemove={removeServiceItem}
                        onQuantityChange={updateServiceQuantity}
                        onQuantityBlur={finalizeServiceQuantity}
                      />
                    ))}
                  </View>
                )}
              </>
            )}

            {/* ── Discount ─────────────────────────────────────────────────── */}
            <Input
              label="Скидка"
              placeholder="0"
              value={discount}
              onChangeText={setDiscount}
              keyboardType="numeric"
              className="mb-3"
            />

            {/* ── Payment type ─────────────────────────────────────────────── */}
            <Text className="text-xs font-medium text-slate-500 mb-2">
              Способ оплаты
            </Text>
            <View className="flex-row gap-2 mb-4">
              {(["cash", "card", "transfer"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setPaymentType(t)}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl border ${
                    paymentType === t
                      ? "bg-primary-500 border-primary-500"
                      : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                  }`}
                >
                  <MaterialIcons
                    name={PAYMENT_ICONS[t]}
                    size={16}
                    color={paymentType === t ? "#fff" : "#94a3b8"}
                  />
                  <Text
                    className={`text-xs font-medium ${
                      paymentType === t
                        ? "text-white"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {PAYMENT_LABELS[t]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Paid ─────────────────────────────────────────────────────── */}
            <Input
              label="Оплачено"
              placeholder={fmt(total)}
              value={paid}
              onChangeText={setPaid}
              keyboardType="numeric"
              hint="Оставьте пустым для полной оплаты"
              className="mb-3"
            />

            {/* ── Notes ────────────────────────────────────────────────────── */}
            <Input
              label="Заметки"
              placeholder="Необязательно"
              value={notes}
              onChangeText={setNotes}
              className="mb-4"
            />

            {/* ── Summary ──────────────────────────────────────────────────── */}
            <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 gap-2 mb-6">
              <View className="flex-row justify-between">
                <Text variant="muted">Подытог</Text>
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {fmt(subtotal)}
                </Text>
              </View>
              {discountVal > 0 && (
                <View className="flex-row justify-between">
                  <Text variant="muted">Скидка</Text>
                  <Text className="text-sm font-medium text-amber-500">
                    − {fmt(discountVal)}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between border-t border-slate-200 dark:border-zinc-700 pt-2 mt-1">
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Сумма
                </Text>
                <Text className="text-base font-bold text-slate-900 dark:text-slate-50">
                  {fmt(total)}
                </Text>
              </View>
              {paidVal > 0 && paidVal < total && (
                <View className="flex-row justify-between">
                  <Text variant="muted">Остаток долга</Text>
                  <Text className="text-sm font-semibold text-red-500">
                    {fmt(debt)}
                  </Text>
                </View>
              )}
            </View>

            <Button
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              Записать продажу
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Product picker — only rendered for product type */}
      {saleType === "product" && (
        <ProductPicker
          visible={pickerVisible}
          products={products}
          onSelect={addToCart}
          onClose={handlePickerClose}
          loading={productsLoading && products.length === 0}
          loadingMore={productsLoading && products.length > 0}
          hasMore={productsHasMore}
          onLoadMore={loadMoreProducts}
        />
      )}

      {/* Barcode scanner */}
      <ScannerOverlay
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={(code) => {
          setScannerVisible(false);
          const found = products.find(
            (p) => p.code && p.code.toLowerCase() === code.toLowerCase()
          );
          if (found) {
            addToCart(found);
            showToast({ message: `${found.name} добавлен в корзину`, variant: "success" });
          } else {
            showToast({ message: `Товар с кодом ${code} не найден`, variant: "error" });
          }
        }}
      />
    </Modal>
  );
}
