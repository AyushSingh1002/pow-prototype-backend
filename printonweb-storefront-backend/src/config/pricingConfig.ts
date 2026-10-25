import { z } from "zod";
import { env } from "./env";
import { PricingConfig } from "../modules/pricing/pricing.types";
import { samplePricingConfig } from "./samplePricingConfig";

const adjustmentSchema = z
  .object({
    unitPriceDelta: z.number().int().optional(),
    unitPriceMultiplier: z.number().positive().optional(),
    flatFee: z.number().int().optional(),
  })
  .strict();

const pricingConfigSchema = z
  .object({
    source: z.string().min(1),
    version: z.string().min(1),
    currency: z.string().length(3),
    isSample: z.boolean(),
    products: z
      .record(
        z.string(),
        z
          .object({
            productId: z.string().min(1),
            baseUnitPrice: z.number().int().nonnegative(),
            minQuantity: z.number().int().positive(),
            maxQuantity: z.number().int().positive(),
            setupFee: z.number().int().nonnegative(),
            allowedOptions: z.record(z.string(), z.array(z.string().min(1)).min(1)),
            incompatibleCombinations: z
              .array(
                z.object({
                  options: z.record(z.string(), z.string()),
                  reason: z.string().min(1),
                })
              )
              .optional(),
            optionAdjustments: z.record(z.string(), z.record(z.string(), adjustmentSchema)),
            quantityBreaks: z.array(
              z.object({
                minQuantity: z.number().int().positive(),
                discountPercent: z.number().int().min(0).max(100),
              })
            ),
          })
          .strict()
      )
      .refine((products) => Object.keys(products).length > 0),
  })
  .strict();

export function loadPricingConfig(): PricingConfig {
  if (env.ENABLE_DEMO_MODE) {
    return samplePricingConfig;
  }

  if (!env.PRODUCTION_PRICING_CONFIG) {
    throw new Error("PRODUCTION_PRICING_CONFIG is required when demo mode is disabled.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(env.PRODUCTION_PRICING_CONFIG);
  } catch {
    throw new Error("PRODUCTION_PRICING_CONFIG must contain valid JSON.");
  }

  const result = pricingConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `PRODUCTION_PRICING_CONFIG is invalid: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }

  if (result.data.isSample) {
    throw new Error("PRODUCTION_PRICING_CONFIG must be approved production pricing, not sample pricing.");
  }

  return result.data;
}
