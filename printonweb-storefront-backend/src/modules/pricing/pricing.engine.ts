import {
  PricingConfig,
  PricingEstimateInput,
  PricingBreakdown,
  PricingLineItem,
} from "./pricing.types";
import {
  NotFoundError,
  UnprocessableEntityError,
} from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";

/**
 * Pure calculation engine for print estimates.
 *
 * Design rules:
 * 1. Pure function: no I/O, no database or network dependencies.
 * 2. Integer money: all amounts are integers in minor units (paise/cents).
 * 3. Rounding rule: Math.round is applied exactly once per calculated line item.
 * 4. Rejection over guessing: any invalid product, quantity, option, or option combination throws.
 * 5. Deterministic and auditable.
 */
export function estimate(
  config: PricingConfig,
  input: PricingEstimateInput
): PricingBreakdown {
  const { productId, options, quantity } = input;

  // 1. Validate Product Existence in Configuration
  const productConfig = config.products[productId];
  if (!productConfig) {
    throw new NotFoundError(
      `Product '${productId}' is not found in pricing configuration.`,
      ErrorCodes.PRODUCT_NOT_FOUND
    );
  }

  // 2. Validate Quantity Bounds
  if (
    !Number.isInteger(quantity) ||
    quantity < productConfig.minQuantity ||
    quantity > productConfig.maxQuantity
  ) {
    throw new UnprocessableEntityError(
      `Quantity ${quantity} is outside the allowed range of ${productConfig.minQuantity} to ${productConfig.maxQuantity} for product '${productId}'.`,
      ErrorCodes.INVALID_QUANTITY,
      [
        {
          path: "quantity",
          issue: `Must be an integer between ${productConfig.minQuantity} and ${productConfig.maxQuantity}`,
        },
      ]
    );
  }

  // 3. Validate Options Coverage and Values
  const requiredOptionKeys = Object.keys(productConfig.allowedOptions);
  const providedOptionKeys = Object.keys(options);

  // Check for missing options
  for (const key of requiredOptionKeys) {
    if (!options[key]) {
      throw new UnprocessableEntityError(
        `Missing required option '${key}' for product '${productId}'.`,
        ErrorCodes.INCOMPATIBLE_OPTIONS,
        [{ path: `options.${key}`, issue: "Option is required" }]
      );
    }

    const allowedValues = productConfig.allowedOptions[key];
    if (!allowedValues.includes(options[key])) {
      throw new UnprocessableEntityError(
        `Invalid option value '${options[key]}' for option '${key}'. Allowed values: ${allowedValues.join(", ")}.`,
        ErrorCodes.INCOMPATIBLE_OPTIONS,
        [{ path: `options.${key}`, issue: `Must be one of: ${allowedValues.join(", ")}` }]
      );
    }
  }

  // Check for disallowed / extra option keys
  for (const key of providedOptionKeys) {
    if (!productConfig.allowedOptions[key]) {
      throw new UnprocessableEntityError(
        `Unknown option key '${key}' provided for product '${productId}'.`,
        ErrorCodes.INCOMPATIBLE_OPTIONS,
        [{ path: `options.${key}`, issue: "Unknown option key" }]
      );
    }
  }

  // 4. Validate Incompatible Option Combinations
  if (productConfig.incompatibleCombinations) {
    for (const rule of productConfig.incompatibleCombinations) {
      const isViolation = Object.entries(rule.options).every(
        ([optKey, optVal]) => options[optKey] === optVal
      );

      if (isViolation) {
        throw new UnprocessableEntityError(
          `Incompatible options combination: ${rule.reason}`,
          ErrorCodes.INCOMPATIBLE_OPTIONS,
          Object.keys(rule.options).map((key) => ({
            path: `options.${key}`,
            issue: `Incompatible with ${JSON.stringify(rule.options)}`,
          }))
        );
      }
    }
  }

  // 5. Line Item Calculations in Integer Minor Units
  const lineItems: PricingLineItem[] = [];

  // A. Base Price Line Item
  const baseUnitPrice = productConfig.baseUnitPrice;
  const baseLineTotal = baseUnitPrice * quantity;
  lineItems.push({
    code: "BASE_PRICE",
    description: `Base unit price (${productId})`,
    unitAmount: baseUnitPrice,
    quantity,
    lineTotal: baseLineTotal,
  });

  // B. Option Adjustments
  let totalUnitAdjustments = 0;
  for (const [optKey, optValue] of Object.entries(options)) {
    const adjConfig = productConfig.optionAdjustments?.[optKey]?.[optValue];
    if (!adjConfig) continue;

    let unitDelta = adjConfig.unitPriceDelta ?? 0;

    // Apply unitPriceMultiplier if configured (e.g. 1.25x for double sides)
    // Rounding rule: Math.round applied once per calculated adjustment unit delta
    if (adjConfig.unitPriceMultiplier && adjConfig.unitPriceMultiplier !== 1) {
      const multiplierDelta = Math.round(
        baseUnitPrice * (adjConfig.unitPriceMultiplier - 1.0)
      );
      unitDelta += multiplierDelta;
    }

    const flatFee = adjConfig.flatFee ?? 0;
    const optionLineTotal = unitDelta * quantity + flatFee;

    if (unitDelta !== 0 || flatFee !== 0) {
      totalUnitAdjustments += unitDelta;
      lineItems.push({
        code: "OPTION_ADJUSTMENT",
        description: `Option adjustment: ${optKey} = ${optValue}${flatFee > 0 ? " (includes flat setup)" : ""}`,
        unitAmount: unitDelta,
        quantity,
        lineTotal: optionLineTotal,
      });
    }
  }

  // C. Quantity Breaks Tier Matching
  // Select highest matching tier where quantity >= minQuantity
  const sortedTiers = [...productConfig.quantityBreaks].sort(
    (a, b) => b.minQuantity - a.minQuantity
  );
  const matchingTier = sortedTiers.find((tier) => quantity >= tier.minQuantity);

  if (matchingTier && matchingTier.discountPercent > 0) {
    const effectivePreDiscountUnitPrice = baseUnitPrice + totalUnitAdjustments;
    // Rounding rule: Math.round applied once for unit discount calculation
    const unitDiscountAmount = Math.round(
      (effectivePreDiscountUnitPrice * matchingTier.discountPercent) / 100
    );
    const discountLineTotal = -(unitDiscountAmount * quantity);

    lineItems.push({
      code: "QUANTITY_BREAK_DISCOUNT",
      description: `Quantity break discount (${matchingTier.discountPercent}% off unit price for >= ${matchingTier.minQuantity} units)`,
      unitAmount: -unitDiscountAmount,
      quantity,
      lineTotal: discountLineTotal,
    });
  }

  // D. Setup Fee Line Item
  if (productConfig.setupFee > 0) {
    lineItems.push({
      code: "SETUP_FEE",
      description: "Pre-press plate, calibration and setup fee",
      unitAmount: productConfig.setupFee,
      quantity: 1,
      lineTotal: productConfig.setupFee,
    });
  }

  // 6. Grand Total Summation (all integer minor units)
  const grandTotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);

  return {
    productId,
    quantity,
    lineItems,
    total: grandTotal,
    currency: config.currency,
    pricingConfigVersion: config.version,
    isSample: true,
    taxIncluded: false,
    shippingIncluded: false,
  };
}
