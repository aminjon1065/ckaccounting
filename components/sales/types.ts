import { Product } from "@/lib/api";

export type PriceMode = "fixed" | "manual" | "markup";

export interface CartItem {
  product: Product;
  quantity: number;
  quantityInput?: string;
  price: number;
  priceMode: PriceMode;
  markupPercent: string;
}

export interface ServiceLineItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  quantityInput?: string;
  price: string;
}
