import * as React from "react";
import { Modal, TouchableOpacity, View, FlatList, TextInput as RNTextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { type Product } from "@/lib/api";
import { fmt } from "./helpers";
import { ScannerOverlay } from "../ScannerOverlay";

export function ProductPicker({
  visible,
  products,
  onSelect,
  onClose,
}: {
  visible: boolean;
  products: Product[];
  onSelect: (p: Product) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = React.useState("");
  const [showScanner, setShowScanner] = React.useState(false);

  const filtered = search
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.code && p.code.toLowerCase().includes(search.toLowerCase()))
      )
    : products;

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
              onPress={() => setShowScanner(true)}
              className="w-10 h-10 bg-primary-100 dark:bg-blue-900/30 rounded-xl items-center justify-center"
            >
              <MaterialIcons name="qr-code-scanner" size={20} color="#0a7ea4" />
            </TouchableOpacity>
          </View>
        </View>

        <ScannerOverlay
          visible={showScanner}
          onClose={() => setShowScanner(false)}
          onScan={(data) => {
            setSearch(data);
            setShowScanner(false);
          }}
        />

        <FlatList
          data={filtered}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => { onSelect(item); onClose(); setSearch(""); }}
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
          )}
          ListEmptyComponent={
            <Text variant="muted" className="text-center py-10">
              Товары не найдены.
            </Text>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}
