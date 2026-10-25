import { z } from "zod";
import { env } from "./env";
import { loadPricingConfig } from "./pricingConfig";
import { PrintOption, Product } from "../modules/catalogue/catalogue.types";

const choiceSchema = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

const printOptionSchema = z
  .object({
    id: z.string().min(1),
    productId: z.string().min(1),
    code: z.string().min(1),
    name: z.string().min(1),
    type: z.enum([
      "size",
      "stock",
      "finish",
      "sides",
      "fold",
      "material",
      "cut",
      "binding",
      "interior",
      "pages",
    ]),
    choices: z.array(choiceSchema).min(1),
  })
  .strict();

const catalogueConfigSchema = z
  .object({
    source: z.string().min(1),
    version: z.string().min(1),
    isSample: z.literal(false),
    products: z
      .array(
        z
          .object({
            id: z.string().min(1),
            slug: z.string().min(1),
            name: z.string().min(1),
            category: z.enum([
              "stationery",
              "marketing",
              "packaging",
              "labels",
              "books",
              "documents",
            ]),
            description: z.string(),
            isActive: z.boolean(),
            minQuantity: z.number().int().positive(),
            maxQuantity: z.number().int().positive(),
            printOptions: z.array(printOptionSchema),
          })
          .strict()
      )
      .min(1),
  })
  .strict()
  .superRefine((config, ctx) => {
    const productIds = new Set<string>();
    const productSlugs = new Set<string>();
    const optionIds = new Set<string>();

    config.products.forEach((product, productIndex) => {
      if (product.maxQuantity < product.minQuantity) {
        ctx.addIssue({
          code: "custom",
          path: ["products", productIndex, "maxQuantity"],
          message: "maxQuantity must be at least minQuantity.",
        });
      }
      if (productIds.has(product.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["products", productIndex, "id"],
          message: "Product IDs must be unique.",
        });
      }
      if (productSlugs.has(product.slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["products", productIndex, "slug"],
          message: "Product slugs must be unique.",
        });
      }
      productIds.add(product.id);
      productSlugs.add(product.slug);

      const optionCodes = new Set<string>();
      product.printOptions.forEach((option, optionIndex) => {
        if (option.productId !== product.id) {
          ctx.addIssue({
            code: "custom",
            path: ["products", productIndex, "printOptions", optionIndex, "productId"],
            message: "Print option productId must match its containing product.",
          });
        }
        if (optionCodes.has(option.code)) {
          ctx.addIssue({
            code: "custom",
            path: ["products", productIndex, "printOptions", optionIndex, "code"],
            message: "Print option codes must be unique within a product.",
          });
        }
        if (optionIds.has(option.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["products", productIndex, "printOptions", optionIndex, "id"],
            message: "Print option IDs must be unique.",
          });
        }
        const choiceValues = option.choices.map((choice) => choice.value);
        if (new Set(choiceValues).size !== choiceValues.length) {
          ctx.addIssue({
            code: "custom",
            path: ["products", productIndex, "printOptions", optionIndex, "choices"],
            message: "Print option choice values must be unique.",
          });
        }
        optionCodes.add(option.code);
        optionIds.add(option.id);
      });
    });
  });

type ProductionCatalogueInput = z.infer<typeof catalogueConfigSchema>;

export interface ProductionCatalogueProduct extends Product {
  printOptions: PrintOption[];
}

export interface ProductionCatalogue {
  source: string;
  version: string;
  products: ProductionCatalogueProduct[];
}

export function loadProductionCatalogue(): ProductionCatalogue {
  if (!env.PRODUCTION_CATALOGUE_CONFIG) {
    throw new Error(
      "PRODUCTION_CATALOGUE_CONFIG is required when demo mode is disabled."
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(env.PRODUCTION_CATALOGUE_CONFIG);
  } catch {
    throw new Error("PRODUCTION_CATALOGUE_CONFIG must contain valid JSON.");
  }

  const result = catalogueConfigSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `PRODUCTION_CATALOGUE_CONFIG is invalid: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }

  return validateAgainstPricing(result.data);
}

function validateAgainstPricing(
  config: ProductionCatalogueInput
): ProductionCatalogue {
  const pricing = loadPricingConfig();
  const configuredProductIds = new Set(config.products.map((product) => product.id));
  const pricedProductIds = new Set(Object.keys(pricing.products));

  if (
    configuredProductIds.size !== pricedProductIds.size ||
    [...pricedProductIds].some((id) => !configuredProductIds.has(id))
  ) {
    throw new Error(
      "Production catalogue product IDs must exactly match PRODUCTION_PRICING_CONFIG."
    );
  }

  return {
    source: config.source,
    version: config.version,
    products: config.products.map((product) => {
      const productPricing = pricing.products[product.id];
      if (
        productPricing.productId !== product.id ||
        productPricing.minQuantity !== product.minQuantity ||
        productPricing.maxQuantity !== product.maxQuantity
      ) {
        throw new Error(
          `Catalogue quantity bounds or productId do not match pricing for '${product.id}'.`
        );
      }

      const optionsByCode = new Map(
        product.printOptions.map((option) => [option.code, option])
      );
      const pricingOptionCodes = Object.keys(productPricing.allowedOptions);
      if (
        optionsByCode.size !== pricingOptionCodes.length ||
        pricingOptionCodes.some((code) => {
          const option = optionsByCode.get(code);
          const expected = productPricing.allowedOptions[code];
          return (
            !option ||
            option.choices.length !== expected.length ||
            expected.some((value) => !option.choices.some((choice) => choice.value === value))
          );
        })
      ) {
        throw new Error(
          `Catalogue print options must match allowedOptions in pricing for '${product.id}'.`
        );
      }

      return {
        ...product,
        currency: pricing.currency,
        isSample: false,
        sampleStartingPrice: productPricing.baseUnitPrice,
      };
    }),
  };
}
