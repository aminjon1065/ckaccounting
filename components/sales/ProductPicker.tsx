import * as React from "react";
import { Modal, TouchableOpacity, View, FlatList, TextInput as RNTextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { type Product } from "@/lib/api";
import { fmt } from "./helpers";
import { ScannerOverlay } from "../ScannerOverlay";

/**
 * One row in the product picker. Memoized so a keystroke in the search
 * input doesn't re-render every visible row — only the rows whose `item`
 * reference actually changed (filter result narrowed/widened) and the
 * keystroke itself happens off the row tree.
 *
 * `onSelect` must be a stable ref (useCallback in the parent picker).
 */
const ProductPickerRow = React.memo(function ProductPickerRow({
  item,
  onSelect,
}: {
  item: Product;
  onSelect: (p: Product) => void;
}) {
  return (
    <TouchableOpacity
      onPress={() => onSelect(item)}
      className="flex-row items-center py-3.5 border-b border-slate-100 dark:border-zinc-800 active:opacity-70"
    >
      <View className="flex-1">
        <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
          {item.name}
        </Text>
        <Text variant="small">
          {item.code ? `${item.code} · ` : ""}Остаток: {item.stock_quantity}
        </Text>
      </View>
      <Text className="text-sm font-semibold text-primary-500">
        {fmt(item.sale_price)}
      </Text>
    </TouchableOpacity>
  );
});

const keyExtractor = (p: Product) => p.id;

export function ProductPicker({
  visible,
  products,
  onSelect,
  onClose,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  loading = false,
}: {
  visible: boolean;
  products: Product[];
  onSelect: (p: Product) => void;
  onClose: () => void;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loading?: boolean;
}) {
  const [search, setSearch] = React.useState("");
  const [showScanner, setShowScanner] = React.useState(false);

  // useDeferredValue (React 19) keeps typing snappy: the input updates
  // immediately, while the expensive `filtered` recalc + the FlatList
  // re-render happen at low priority. On a 500-product catalog this is
  // the difference between input lag and instant feedback.
  const deferredSearch = React.useDeferredValue(search);

  const filtered = React.useMemo(() => {
    if (!deferredSearch) return products;
    const needle = deferredSearch.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.code && p.code.toLowerCase().includes(needle))
    );
  }, [products, deferredSearch]);

  // Wraps the parent's `onSelect` with picker-local side effects (close
  // modal, clear search). Stable across renders so ProductPickerRow's
  // memoization holds — without this, `onSelect` identity would change
  // every render and bust the row's React.memo gate.
  const handleSelect = React.useCallback(
    (p: Product) => {
      onSelect(p);
      onClose();
      setSearch("");
    },
    [onSelect, onClose]
  );

  const renderItem = React.useCallback(
    ({ item }: { item: Product }) => (
      <ProductPickerRow item={item} onSelect={handleSelect} />
    ),
    [handleSelect]
  );

  const handleScan = React.useCallback((data: string) => {
    setSearch(data);
    setShowScanner(false);
  }, []);

  const handleScannerClose = React.useCallback(() => {
    setShowScanner(false);
  }, []);

  const handleScannerOpen = React.useCallback(() => {
    setShowScanner(true);
  }, []);

  const listEmpty = React.useMemo(
    () => (
      <Text variant="muted" className="text-center py-10">
        {loading
          ? "Загрузка каталога…"
          : search
            ? "По запросу ничего не найдено."
            : "Каталог пуст. Добавьте товары."}
      </Text>
    ),
    [loading, search]
  );

  const listFooter = React.useMemo(
    () =>
      loadingMore ? (
        <Text variant="muted" className="text-center py-4">Загрузка…</Text>
      ) : null,
    [loadingMore]
  );

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
            Выберите товар
          </Text>
          <View style={{ width: 22 }} />
        </View>

        <View className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800">
          <View className="flex-row items-center gap-2">
            <View className="flex-1 flex-row items-center bg-slate-100 dark:bg-zinc-800 rounded-xl px-3 gap-2">
              <MaterialIcons name="search" size={18} color="#94a3b8" />
              <RNTextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Поиск по названию или штрих-коду…"
                placeholderTextColor="#94a3b8"
                className="flex-1 py-2.5 text-sm text-slate-900 dark:text-slate-50"
              />
            </View>
            <TouchableOpacity
              onPress={handleScannerOpen}
              className="w-10 h-10 bg-primary-100 dark:bg-blue-900/30 rounded-xl items-center justify-center"
            >
              <MaterialIcons name="qr-code-scanner" size={20} color="#0a7ea4" />
            </TouchableOpacity>
          </View>
        </View>

        <ScannerOverlay
          visible={showScanner}
          onClose={handleScannerClose}
          onScan={handleScan}
        />

        <FlatList
          data={filtered}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ padding: 16 }}
          renderItem={renderItem}
          ListEmptyComponent={listEmpty}
          ListFooterComponent={listFooter}
          onEndReached={hasMore ? onLoadMore : undefined}
          onEndReachedThreshold={0.3}
          // Virtualization tuning — fits a typical phone viewport (~12 rows
          // visible) with one extra screen of buffer above/below. Bigger
          // windowSize wastes memory; smaller causes blank flashes on fast
          // scroll. removeClippedSubviews helps Android in particular.
          initialNumToRender={20}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews
          // Keyboard stays open on row tap so the user can keep refining
          // their search if they didn't pick the right product.
          keyboardShouldPersistTaps="handled"
        />
      </SafeAreaView>
    </Modal>
  );
}
