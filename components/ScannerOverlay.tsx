import React, { useState, useEffect } from "react";
import { Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import { Camera, CameraView, useCameraPermissions } from "expo-camera";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text } from "@/components/ui";

export function ScannerOverlay({
  visible,
  onClose,
  onScan,
}: {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (visible) {
      setScanned(false);
    }
  }, [visible]);

  if (!visible) return null;

  if (!permission) {
    return <View />;
  }

  if (!permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" transparent>
        <View className="flex-1 bg-black/90 items-center justify-center px-6">
          <Text className="text-white text-center mb-4">
            Нам нужен доступ к вашей камере для сканирования штрихкодов.
          </Text>
          <TouchableOpacity
            className="bg-primary-500 py-3 px-6 rounded-xl"
            onPress={requestPermission}
          >
            <Text className="text-white font-semibold">Разрешить</Text>
          </TouchableOpacity>
          <TouchableOpacity className="mt-6" onPress={onClose}>
            <Text className="text-slate-400">Отмена</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={StyleSheet.absoluteFillObject} className="bg-black/90">
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          onBarcodeScanned={scanned ? undefined : ({ data }) => {
            setScanned(true);
            onScan(data);
          }}
          barcodeScannerSettings={{
            barcodeTypes: ["qr", "ean13", "ean8", "upc_a", "upc_e", "code39", "code128"],
          }}
        />

        {/* Overlay targeting box */}
        <View className="flex-1 items-center justify-center pointer-events-none">
          <View className="w-64 h-32 border-2 border-white/50 rounded-xl items-center justify-center">
            {/* Corner brackets */}
            <View className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-white -mt-1 -ml-1" />
            <View className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-white -mt-1 -mr-1" />
            <View className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-white -mb-1 -ml-1" />
            <View className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-white -mb-1 -mr-1" />
            <View className="w-full h-[1px] bg-red-500/50 absolute" />
          </View>
        </View>

        <TouchableOpacity
          onPress={onClose}
          className="absolute top-12 left-6 bg-black/50 p-2 rounded-full"
        >
          <MaterialIcons name="close" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
