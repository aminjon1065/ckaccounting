import React from "react";
import { View, Text, Modal, TouchableOpacity, ScrollView } from "react-native";
import { useConflict, type Conflict, type ConflictEntry } from "@/lib/sync/ConflictContext";

interface ConflictCardProps {
  conflict: Conflict;
  onResolve: (choice: "local" | "server") => void;
  onDismiss: () => void;
}

function ConflictCard({ conflict, onResolve, onDismiss }: ConflictCardProps) {
  const entityLabel = {
    product: "Товар",
    sale: "Продажа",
    expense: "Расход",
    purchase: "Закупка",
    debt: "Долг",
  }[conflict.entityType];

  return (
    <View className="bg-white rounded-xl border border-gray-200 p-4 mb-3 shadow-sm">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <View className="w-2 h-2 rounded-full bg-red-500" />
          <Text className="text-base font-semibold text-gray-900">
            Конфликт: {entityLabel}
          </Text>
        </View>
        <TouchableOpacity onPress={onDismiss} className="p-1">
          <Text className="text-gray-400 text-lg">×</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="max-h-60" nestedScrollEnabled>
        {conflict.conflicts.map((entry, idx) => (
          <View key={idx} className="mb-3">
            <Text className="text-xs font-medium text-gray-500 uppercase mb-1">
              {entry.field}
            </Text>
            <View className="flex-row gap-2">
              <View className="flex-1 bg-red-50 border border-red-200 rounded-lg p-2">
                <Text className="text-xs text-red-600 font-medium mb-0.5">Локально</Text>
                <Text className="text-sm text-gray-900">
                  {formatValue(entry.localValue)}
                </Text>
              </View>
              <View className="flex-1 bg-blue-50 border border-blue-200 rounded-lg p-2">
                <Text className="text-xs text-blue-600 font-medium mb-0.5">Сервер</Text>
                <Text className="text-sm text-gray-900">
                  {formatValue(entry.serverValue)}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      <View className="flex-row gap-2 mt-2">
        <TouchableOpacity
          className="flex-1 bg-gray-100 border border-gray-300 rounded-lg py-2 px-3"
          onPress={() => onResolve("server")}
        >
          <Text className="text-sm font-medium text-gray-700 text-center">
            Использовать сервер
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-blue-600 rounded-lg py-2 px-3"
          onPress={() => onResolve("local")}
        >
          <Text className="text-sm font-medium text-white text-center">
            Оставить локально
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ConflictResolutionModal() {
  const { conflicts, resolveConflict, dismissConflict } = useConflict();

  if (conflicts.length === 0) return null;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {}}
    >
      <View className="flex-1 bg-gray-50">
        <View className="bg-white border-b border-gray-200 px-4 py-4">
          <Text className="text-lg font-bold text-gray-900">
            Конфликты синхронизации
          </Text>
          <Text className="text-sm text-gray-500 mt-0.5">
            Обнаружено {conflicts.length} конфликт(ов). Выберите версию для каждого.
          </Text>
        </View>

        <ScrollView className="flex-1 px-4 py-4">
          {conflicts.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              onResolve={(choice) => resolveConflict(conflict.id, choice)}
              onDismiss={() => dismissConflict(conflict.id)}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
