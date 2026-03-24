import { Product } from "@/lib/api";

export type PriceMode = "fixed" | "manual" | "auto";

export interface CartItem {
  product: Product;
  quantity: number;
  price: number;
  priceMode: PriceMode;
  markupPercent: string;
}

export interface ServiceLineItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  price: string;
}
