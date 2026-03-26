import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, CreateSalePayload } from "@/lib/api";

export interface OfflineSale {
  id: string; // uuid
  payload: CreateSalePayload;
  createdAt: string;
}

interface SyncState {
  pendingSales: OfflineSale[];
  isSyncing: boolean;
  addPendingSale: (payload: CreateSalePayload) => void;
  removePendingSale: (id: string) => void;
  syncSales: (token: string) => Promise<void>;
  clearQueue: () => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => ({
      pendingSales: [],
      isSyncing: false,

      addPendingSale: (payload) => {
        const newSale: OfflineSale = {
          id: Math.random().toString(36).substring(2, 15) + Date.now().toString(36), // Simple pseudo-UUID
          payload,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ pendingSales: [...state.pendingSales, newSale] }));
      },

      removePendingSale: (id) => {
        set((state) => ({
          pendingSales: state.pendingSales.filter((sale) => sale.id !== id),
        }));
      },

      clearQueue: () => set({ pendingSales: [] }),

      syncSales: async (token: string) => {
        const { pendingSales, removePendingSale } = get();
        if (pendingSales.length === 0) return;

        set({ isSyncing: true });

        try {
          for (const sale of pendingSales) {
            try {
              await api.sales.create(sale.payload, token);
              // Successfully synced to backend, remove from queue
              removePendingSale(sale.id);
            } catch (error: any) {
              // If the network request failed, we keep it in the queue for next time
              // but if it's a 4xx error (e.g. Validation), we might want to log it
              console.warn(`Failed to sync sale ${sale.id}:`, error?.message);
              // Avoid breaking the loop if one fails, try the next
            }
          }
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    {
      name: "ckaccounting-sync-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
