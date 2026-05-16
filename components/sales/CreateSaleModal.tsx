import * as React from "react";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Modal, TouchableOpacity, View, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text, Button, Input, Select } from "@/components/ui";
import { api, ApiError, type CreateSalePayload, type Product, type Sale, type Shop } from "@/lib/api";
import { parseDecimal } from "@/lib/formatters";
import { useAuth } from "@/store/auth";
import { ProductPicker } from "./ProductPicker";
import { ScannerOverlay } from "@/components/ScannerOverlay";
import { defaultPriceMode, deriveProductPrice, fmt, PAYMENT_ICONS, PAYMENT_LABELS } from "./helpers";
import { PriceMode, CartItem, ServiceLineItem } from "./types";
import { CartRow } from "./CartRow";
import { ServiceItemRow } from "./ServiceItemRow";
import { deleteLocalProduct, getLocalProducts, insertOrUpdateProducts, insertOrUpdateRemoteSales, insertNotification, hasLowStockAlertBeenSent, markLowStockAlertSent, localScope } from "@/lib/db";
import { useToast } from "@/store/toast";
import { reportError } from "@/lib/observability/reporter";
import { can, effectiveShopId, needsShopPicker, pickerShopIds } from "@/lib/permissions";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { useCacheMethods } from "@/lib/cache/CacheProvider";
import { STORAGE_KEYS } from "@/constants/config";

type PaymentType = "cash" | "card" | "transfer";
const PAYMENT_TYPES: PaymentType[] = ["cash", "card", "transfer"];

function parsePaymentTypePref(value: string | null): PaymentType {
  return PAYMENT_TYPES.includes(value as PaymentType) ? (value as PaymentType) : "cash";
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
  const { reconcileRemoteProducts } = useCacheMethods();
  // Multi-shop UX: super_admin and multi-shop owners pick a shop in the
  // form; sellers and single-shop owners get an implicit shop and no
  // picker.
  const showShopPicker = needsShopPicker(user);
  const implicitShopId = effectiveShopId(user);
  const allowedShopIds = React.useMemo(() => pickerShopIds(user), [user]);
  const canEditPrice = user?.role !== "seller";
  const { showToast } = useToast();

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
  // Tracks whether the cashier has hand-typed into "Оплачено". While false
  // (default state), the field auto-mirrors the cart total — fits the
  // typical bazaar happy-path where the customer pays in full and the
  // cashier just hits submit. Once they touch the field we stop touching
  // it; partial payments and overpayments stay sticky.
  const paidEditedRef = React.useRef(false);
  const handlePaidChange = React.useCallback((value: string) => {
    paidEditedRef.current = true;
    setPaid(value);
  }, []);
  const [notes, setNotes] = React.useState("");
  const [paymentType, setPaymentType] = React.useState<PaymentType>("cash");

  // Restore the user's last payment-type choice when the modal opens.
  // SecureStore lookups are async, so the initial render keeps the "cash"
  // default; the value updates on the next tick. Persisted on submit.
  React.useEffect(() => {
    if (!visible) return;
    SecureStore.getItemAsync(STORAGE_KEYS.prefSalePaymentType)
      .then((stored) => setPaymentType(parsePaymentTypePref(stored)))
      .catch(() => {});
  }, [visible]);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [scannerVisible, setScannerVisible] = React.useState(false);
  const [productsHasMore, setProductsHasMore] = React.useState(false);
  const [productsNextCursor, setProductsNextCursor] = React.useState<string | null>(null);
  // Inline product create flow — triggered from the picker's "+ Создать"
  // CTA when the seller types a name that isn't in the catalog yet.
  const [createProductVisible, setCreateProductVisible] = React.useState(false);
  const [createProductSeed, setCreateProductSeed] = React.useState("");
  const canCreateProduct = can(user?.role, "products:edit");

  // Load shops when a picker is needed. Server-side scoping ensures
  // owners get only their owned shops, super_admin gets the full list.
  React.useEffect(() => {
    if (visible && showShopPicker) {
      api.shops.list(token)
        .then((res) => {
          const raw = res.data ?? [];
          const list = allowedShopIds == null
            ? raw
            : raw.filter((s) => allowedShopIds.includes(s.id));
          setShops(list);
          // Pre-fill from the last successful sale if the saved shop is
          // still in the user's allowed set — multi-shop owners doing PoS
          // typically work one shop at a time, no need to re-select on
          // every "Create sale".
          SecureStore.getItemAsync(STORAGE_KEYS.prefLastShopId)
            .then((stored) => {
              if (stored && list.some((s) => String(s.id) === stored)) {
                setShopId(stored);
              }
            })
            .catch(() => {});
        })
        .catch((e) => reportError(e, { tag: "sale-modal-shops-load" }));
    }
  }, [visible, showShopPicker, token, allowedShopIds]);

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
    setCart([]); setServiceItems([]);
    setCustomerName(""); setDiscount("");
    setPaid(""); setNotes("");
    setPaymentType("cash"); setError("");
    serviceIdRef.current = 0;
    setShopId("");
    paidEditedRef.current = false;
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
    // Reconcile FIRST so the picker doesn't show ghost products the admin
    // soft- or hard-deleted on the server. Without this the cashier would
    // happily add a stale row, hit submit, and only then see "Товар не
    // найден" — by which point recovery costs them their cart and time.
    // Both calls are non-blocking from the user's perspective: the picker
    // shows whatever's in the local cache instantly, then refreshes.
    reconcileRemoteProducts().catch((e) =>
      reportError(e, { tag: "sale-modal-products-reconcile", shopId: activeShopId })
    );
    loadProductsForSale(activeShopId ?? undefined).catch((e) =>
      reportError(e, { tag: "sale-modal-products-effect", shopId: activeShopId })
    );
  }, [visible, showShopPicker, activeShopId, loadProductsForSale, reconcileRemoteProducts]);

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

  const handleRequestCreateProduct = React.useCallback((seedName: string) => {
    setCreateProductSeed(seedName);
    setCreateProductVisible(true);
  }, []);

  const handleProductCreated = React.useCallback((saved: Product) => {
    // Keep the picker's catalogue in sync — the user will see the new SKU
    // if they reopen the picker mid-sale.
    setProducts((prev) => (prev.some((p) => p.id === saved.id) ? prev : [saved, ...prev]));
    addToCart(saved);
    setCreateProductVisible(false);
    setCreateProductSeed("");
    setPickerVisible(false);
    showToast({ message: `${saved.name} добавлен в каталог и в корзину`, variant: "success" });
  }, [addToCart, showToast]);

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

  // ±1 stepper used by the CartRow's plus / minus buttons. Mirrors the
  // purchase modal's pattern. Hitting "−" past 1 drops the line entirely
  // (no zero-quantity items sit in the cart); hitting "+" past stock
  // shows a non-blocking warning and stops at the available quantity.
  const adjustCartQuantity = React.useCallback((productId: string, delta: number) => {
    setCart((prev) => {
      const target = prev.find((c) => c.product.id === productId);
      if (!target) return prev;

      const availableQty = target.product.stock_quantity ?? 0;
      const nextQty = target.quantity + delta;
      if (nextQty > availableQty) {
        showToast({
          message: `Нет столько на складе (доступно: ${availableQty})`,
          variant: "warning",
        });
        return prev;
      }

      return prev
        .map((c) => {
          if (c.product.id !== productId) return c;
          const quantity = Math.max(0, nextQty);
          return {
            ...c,
            quantity,
            quantityInput: String(quantity),
            price: c.priceMode === "manual"
              ? c.price
              : deriveProductPrice(c.product, c.priceMode, c.markupPercent, Math.max(quantity, 1)),
          };
        })
        .filter((c) => c.quantity > 0);
    });
  }, [showToast]);

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

  // Subtotal across both products and services so a mixed cart sums correctly.
  const subtotal =
    cart.reduce((s, c) => s + c.price * c.quantity, 0)
    + serviceItems.reduce((s, i) => s + (parseDecimal(i.price) || 0) * i.quantity, 0);
  const discountVal = parseDecimal(discount) || 0;
  const total = Math.max(0, subtotal - discountVal);
  const paidVal = parseDecimal(paid) || 0;
  const unpaid = Math.max(0, total - paidVal); // amount still owed
  const overpaid = Math.max(0, paidVal - total); // amount paid above the bill

  // Sync "Оплачено" with the running total until the cashier types into
  // the field. Re-fires whenever the cart / discount changes so adding a
  // new item bumps the prefilled amount automatically.
  React.useEffect(() => {
    if (paidEditedRef.current) return;
    setPaid(total > 0 ? String(total) : "");
  }, [total]);

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setError("");

    if (showShopPicker && !shopId) { setError("Выберите магазин."); return; }
    if (!showShopPicker && implicitShopId === null) { setError("Магазин не назначен."); return; }

    // Mixed cart: a sale can carry products, services, or both. Require at
    // least one row total.
    if (cart.length === 0 && serviceItems.length === 0) {
      setError("Добавьте товар или услугу."); return;
    }
    if (serviceItems.some((i) => !i.name.trim())) {
      setError("Укажите название каждой услуги."); return;
    }

    // Validate Seller cannot sell below sale_price
    if (user?.role === "seller" && cart.length > 0) {
      for (const c of cart) {
        if (c.price < (c.product.sale_price ?? 0)) {
          setError(`Цена "${c.product.name}" ниже прайса (${c.product.sale_price})`);
          return;
        }
      }
    }

    // Build the unified items array. Server derives `sale.type` from this
    // payload — see SaleService::createSale.
    const productItems = cart.map((c) => ({
      product_id: c.product.id,
      quantity: c.quantity,
      price: c.price,
    }));
    const serviceItemsPayload = serviceItems.map((s) => ({
      name: s.name.trim(),
      unit: s.unit.trim() || undefined,
      quantity: s.quantity,
      price: parseDecimal(s.price) || 0,
    }));

    const payload: CreateSalePayload = {
      // Hint to legacy clients/dashboards — server may override based on
      // the actual cart contents. Mixed carts come back as "product".
      type: cart.length > 0 ? "product" : "service",
      payment_type: paymentType,
      items: [...productItems, ...serviceItemsPayload] as CreateSalePayload["items"],
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
      // Persist payment-type + shop choice so the next "Create sale" opens
      // with the same selection — typical PoS use is the same shop / payment
      // type for dozens of sales in a row.
      SecureStore.setItemAsync(STORAGE_KEYS.prefSalePaymentType, paymentType).catch(() => {});
      if (showShopPicker && shopId) {
        SecureStore.setItemAsync(STORAGE_KEYS.prefLastShopId, shopId).catch(() => {});
      }
      // Check low stock for sold products (online case)
      // Low-stock alerts only apply to product lines (services don't deplete
      // a tracked stock figure). Loop over the cart regardless of the
      // (now-derived) `saleType` flag.
      if (cart.length > 0) {
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
      // Persist into local DB immediately with the correct shop_id so
      // scoped reads (reports, list screens) include it before the next
      // sync cycle. Without this the fetcher catches it eventually, but
      // it'd be invisible right after creation.
      const persistShopId = showShopPicker && shopId
        ? Number(shopId)
        : implicitShopId ?? undefined;
      await insertOrUpdateRemoteSales([created], persistShopId).catch((err) =>
        reportError(err, { tag: "sale-modal-persist" }),
      );
      onCreated(created);
      showToast({ message: "Продажа записана", variant: "success" });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else if (e instanceof ApiError && e.status === 422 && e.errors) {
        // Server validation failed. Two recoverable cases:
        //   1) `items.{i}.product_id` — the product was deleted or moved
        //      to another shop. Evict it from local cache + cart.
        //   2) `items.{i}.quantity` / `items.{i}.price` — stale stock or
        //      price in the local cache. Refresh those products from the
        //      server so the cart row reflects the actual values; the
        //      user then sees the new numbers and decides whether to
        //      reduce qty / accept the new price.
        // The original per-field error stays in the form-level banner so
        // the user can read what failed and where.
        const ghostIndices = new Set<number>();
        const staleIndices = new Set<number>();
        for (const key of Object.keys(e.errors)) {
          const ghostMatch = key.match(/^items\.(\d+)\.product_id$/);
          if (ghostMatch) {
            ghostIndices.add(Number(ghostMatch[1]));
            continue;
          }
          // `items.{i}.{quantity|price}` — server's view of the cart line
          // disagrees with the local cache. Refresh those products so
          // the user sees the truth.
          const staleMatch = key.match(/^items\.(\d+)\.(quantity|price)$/);
          if (staleMatch) {
            staleIndices.add(Number(staleMatch[1]));
          }
        }

        let evictedNames: string[] = [];
        if (ghostIndices.size > 0 && cart.length > 0) {
          const ghostIds = [...ghostIndices]
            .map((i) => cart[i]?.product?.id)
            .filter((id): id is string => !!id);
          evictedNames = [...ghostIndices]
            .map((i) => cart[i]?.product?.name)
            .filter((n): n is string => !!n);

          // Evict the ghost rows from local SQLite + the in-memory list so
          // the picker stops offering them on retry. Best-effort — failures
          // here are not user-actionable.
          await Promise.all(
            ghostIds.map((id) =>
              deleteLocalProduct(id).catch(() => {}),
            ),
          );
          setProducts((prev) => prev.filter((p) => !ghostIds.includes(p.id)));
          setCart((prev) => prev.filter((c) => !ghostIds.includes(c.product.id)));

          // Trigger a fresh reconcile so the next picker open is clean.
          reconcileRemoteProducts().catch(() => {});
        }

        // Refresh stale cart products from the server. Done after the
        // ghost-eviction so we don't try to GET ids we just confirmed don't
        // exist. Updates BOTH the picker list and the in-cart product
        // reference so prices / stock numbers shown in the row match what
        // the server enforced.
        if (staleIndices.size > 0 && cart.length > 0) {
          const staleProductIds = [...staleIndices]
            .map((i) => cart[i]?.product?.id)
            .filter((id): id is string => !!id && !evictedNames.length);

          if (staleProductIds.length > 0) {
            const refreshed = await Promise.all(
              staleProductIds.map((id) =>
                api.products.get(id, token).catch(() => null),
              ),
            );
            const byId = new Map<string, Product>();
            for (const p of refreshed) {
              if (p) byId.set(p.id, p);
            }
            if (byId.size > 0) {
              await insertOrUpdateProducts([...byId.values()]).catch(() => {});
              setProducts((prev) =>
                prev.map((p) => byId.get(p.id) ?? p),
              );
              setCart((prev) =>
                prev.map((c) => {
                  const fresh = byId.get(c.product.id);
                  if (!fresh) return c;
                  // Clamp qty to the new stock if the user was over the limit;
                  // keep their typed price but flag it on retry through the
                  // existing seller "below sale_price" check.
                  const maxQty = fresh.stock_quantity ?? c.quantity;
                  const clampedQty = Math.min(c.quantity, maxQty);
                  return {
                    ...c,
                    product: fresh,
                    quantity: clampedQty,
                    quantityInput: String(clampedQty),
                  };
                }),
              );
            }
          }
        }

        if (evictedNames.length > 0) {
          showToast({
            message:
              evictedNames.length === 1
                ? `«${evictedNames[0]}» был удалён администратором и убран из корзины.`
                : `${evictedNames.length} товара(ов) были удалены администратором и убраны из корзины.`,
            variant: "warning",
          });
        } else if (staleIndices.size > 0) {
          showToast({
            message: "Данные товаров обновлены. Проверьте остатки и цены и сохраните снова.",
            variant: "warning",
          });
        }

        // Always show the per-field breakdown so the user knows exactly
        // which line and field failed. After our auto-recovery above, the
        // values they see should match the server.
        setError(e.describeErrors());
      } else {
        // Show the full per-field error breakdown when the server
        // returned a 422 with `errors`. Just `e.message` often shows only
        // the first message ("validation.exists" raw key from Laravel
        // when lang files aren't published) — describeErrors lists every
        // failing field so the user knows what to fix.
        setError(
          e instanceof ApiError
            ? e.describeErrors()
            : "Что-то пошло не так."
        );
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
              Новая продажа
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Покупатель, товары и оплата
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView
          behavior="padding"
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

            {/* Customer */}
            <Input
              label="Покупатель"
              placeholder="Необязательно"
              value={customerName}
              onChangeText={setCustomerName}
              className="mb-4"
            />

            {/* ── Products section ─────────────────────────────────────────
                Always rendered alongside services so the cashier can sell
                e.g. a TV + delivery + installation in a single sale. The
                sale type is now derived server-side from the cart contents
                (any product line ⇒ "product"). */}
            <View className="mb-2 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <MaterialIcons name="inventory-2" size={16} color="#0a7ea4" />
                <Text className="font-heading text-[14px] tracking-tight text-slate-900 dark:text-white">
                  Товары{cart.length > 0 ? ` · ${cart.length}` : ""}
                </Text>
              </View>
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
              <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 items-center mb-4">
                <Text variant="muted" className="text-center text-xs">
                  {productsLoading ? "Загрузка товаров..." : "Товары не выбраны"}
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
                    onQuantityAdjust={adjustCartQuantity}
                    onMarkupChange={updateMarkup}
                    onPriceChange={updatePrice}
                  />
                ))}
              </View>
            )}

            {/* ── Services section ─────────────────────────────────────── */}
            <View className="mb-2 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <MaterialIcons name="handyman" size={16} color="#0a7ea4" />
                <Text className="font-heading text-[14px] tracking-tight text-slate-900 dark:text-white">
                  Услуги{serviceItems.length > 0 ? ` · ${serviceItems.length}` : ""}
                </Text>
              </View>
              <TouchableOpacity
                onPress={addServiceItem}
                className="flex-row items-center gap-1 bg-primary-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg"
              >
                <MaterialIcons name="add" size={16} color="#0a7ea4" />
                <Text className="text-xs font-semibold text-primary-500">
                  Добавить услугу
                </Text>
              </TouchableOpacity>
            </View>

            {serviceItems.length === 0 ? (
              <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 items-center mb-4">
                <Text variant="muted" className="text-center text-xs">
                  Услуги не добавлены
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
            <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 mb-2">
              Способ оплаты
            </Text>
            <View className="flex-row gap-2 mb-4">
              {(["cash", "card", "transfer"] as const).map((t) => {
                const active = paymentType === t;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setPaymentType(t)}
                    className={`flex-1 items-center gap-1.5 py-3 rounded-2xl border ${
                      active
                        ? "border-primary-500 bg-primary-100 dark:bg-primary-900/30"
                        : "border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                    }`}
                    style={active ? { borderWidth: 1.5 } : undefined}
                  >
                    <MaterialIcons
                      name={PAYMENT_ICONS[t]}
                      size={20}
                      color={active ? "#0a7ea4" : "#64748b"}
                    />
                    <Text
                      className={`text-[12.5px] font-semibold ${
                        active ? "text-primary-600 dark:text-primary-300" : "text-slate-700 dark:text-zinc-300"
                      }`}
                    >
                      {PAYMENT_LABELS[t]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Paid ─────────────────────────────────────────────────────── */}
            <Input
              label="Оплачено"
              placeholder="0"
              value={paid}
              onChangeText={handlePaidChange}
              keyboardType="numeric"
              hint="По умолчанию равно сумме счёта. Измените, если клиент оплатил частично или с переплатой."
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
            <View className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 mb-6">
              <View className="flex-row justify-between mb-1.5">
                <Text className="text-[13px] text-slate-500 dark:text-zinc-400">Подытог</Text>
                <Text
                  className="font-heading text-[13px] tracking-tight text-slate-700 dark:text-zinc-200"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {fmt(subtotal)}
                </Text>
              </View>
              {discountVal > 0 && (
                <View className="flex-row justify-between mb-1.5">
                  <Text className="text-[13px] text-slate-500 dark:text-zinc-400">Скидка</Text>
                  <Text className="font-heading text-[13px] tracking-tight text-amber-500">
                    − {fmt(discountVal)}
                  </Text>
                </View>
              )}
              <View
                className="my-2 border-t border-dashed border-slate-200 dark:border-zinc-700"
                style={{ borderStyle: "dashed" }}
              />
              <View className="flex-row justify-between items-baseline mb-1.5">
                <Text className="text-[14px] font-semibold text-slate-900 dark:text-white">
                  К оплате
                </Text>
                <Text
                  className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {fmt(total)}
                </Text>
              </View>
              <View className="flex-row justify-between mb-1.5">
                <Text className="text-[13px] text-slate-500 dark:text-zinc-400">Оплачено</Text>
                <Text
                  className="font-heading text-[13px] tracking-tight text-slate-700 dark:text-zinc-200"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {fmt(paidVal)}
                </Text>
              </View>
              {unpaid > 0 && (
                <View className="flex-row justify-between mb-1.5">
                  <Text className="text-[13px] text-slate-500 dark:text-zinc-400">Не доплачено</Text>
                  <Text className="font-heading text-[13px] font-semibold tracking-tight text-red-500">
                    {fmt(unpaid)}
                  </Text>
                </View>
              )}
              {overpaid > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-[13px] text-slate-500 dark:text-zinc-400">Переплата</Text>
                  <Text className="font-heading text-[13px] font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
                    {fmt(overpaid)}
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

      {/* Product picker — always rendered now that a sale can mix products
          and services. Visibility is gated by `pickerVisible` which only
          flips true via the "Добавить товар" button. */}
      <ProductPicker
        visible={pickerVisible}
        products={products}
        onSelect={addToCart}
        onClose={handlePickerClose}
        loading={productsLoading && products.length === 0}
        loadingMore={productsLoading && products.length > 0}
        hasMore={productsHasMore}
        onLoadMore={loadMoreProducts}
        canCreate={canCreateProduct}
        onRequestCreate={handleRequestCreateProduct}
      />

      {/* Inline product create — opens from the picker's "+ Создать" CTA.
          The new product is locked to the sale's shop so the sale
          submission later doesn't 404 on a cross-shop product_id. */}
      {canCreateProduct && (
        <ProductFormModal
          visible={createProductVisible}
          editing={null}
          initialName={createProductSeed}
          initialShopId={
            showShopPicker
              ? (shopId ? Number(shopId) : null)
              : implicitShopId
          }
          onClose={() => {
            setCreateProductVisible(false);
            setCreateProductSeed("");
          }}
          onSaved={handleProductCreated}
          token={token}
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
