export interface OptionAdjustment {
  /** Delta added directly to the unit base price in minor units */
  unitPriceDelta?: number;
  /** Percentage multiplier adjustment (e.g. 1.50 = 150% of unit price) */
  unitPriceMultiplier?: number;
  /** Fixed flat surcharge for the entire line, in minor units */
  flatFee?: number;
}

export interface QuantityBreakTier {
  minQuantity: number;
  /** Integer percentage discount (0 to 100) applied to unit price */
  discountPercent: number;
}

export interface IncompatibleCombination {
  options: Record<string, string>;
  reason: string;
}

export interface ProductPricingConfig {
  productId: string;
  baseUnitPrice: number; // In minor units (e.g. 500 paise)
  minQuantity: number;
  maxQuantity: number;
  setupFee: number; // In minor units (e.g. 20000 paise = 200 INR)
  allowedOptions: Record<string, string[]>;
  incompatibleCombinations?: IncompatibleCombination[];
  optionAdjustments: Record<string, Record<string, OptionAdjustment>>;
  quantityBreaks: QuantityBreakTier[];
}

export interface PricingConfig {
  source: string;
  version: string;
  currency: string;
  isSample: boolean;
  products: Record<string, ProductPricingConfig>;
}

export interface PricingEstimateInput {
  productId: string;
  options: Record<string, string>;
  quantity: number;
}

export type PricingLineItemCode =
  | "BASE_PRICE"
  | "OPTION_ADJUSTMENT"
  | "QUANTITY_BREAK_DISCOUNT"
  | "SETUP_FEE";

export interface PricingLineItem {
  code: PricingLineItemCode;
  description: string;
  unitAmount: number; // In minor units
  quantity: number;
  lineTotal: number; // In minor units
}

export interface PricingBreakdown {
  productId: string;
  quantity: number;
  lineItems: PricingLineItem[];
  total: number; // Grand total in minor units
  currency: string;
  pricingConfigVersion: string;
  isSample: boolean;
  taxIncluded: false;
  shippingIncluded: false;
}
