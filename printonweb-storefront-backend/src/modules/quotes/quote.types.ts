import { PricingBreakdown, PricingLineItem } from "../pricing/pricing.types";

export interface CreateQuoteDTO {
  productId: string;
  options: Record<string, string>;
  quantity: number;
  customerId?: string;
}

export interface QuoteRecord {
  id: string; // UUID v4
  productId: string;
  validatedOptions: Record<string, string>;
  quantity: number;
  lineItems: PricingLineItem[];
  total: number; // Integer minor units
  currency: string;
  pricingConfigVersion: string;
  isSample: boolean;
  taxIncluded: false;
  shippingIncluded: false;
  expiresAt: string; // ISO 8601
  createdAt: string; // ISO 8601
  customerId?: string;
}

export type QuoteResponseDTO = Omit<QuoteRecord, "validatedOptions">;
