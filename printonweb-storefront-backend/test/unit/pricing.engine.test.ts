import { describe, it, expect } from "vitest";
import { estimate } from "../../src/modules/pricing/pricing.engine";
import { samplePricingConfig } from "../../src/config/samplePricingConfig";
import {
  NotFoundError,
  UnprocessableEntityError,
} from "../../src/core/errors/AppError";
import { ErrorCodes } from "../../src/core/errors/errorCodes";

describe("Pricing Engine - Pure Function Unit Tests", () => {
  it("computes deterministic pricing breakdown for valid business-cards quote", () => {
    const input = {
      productId: "business-cards",
      options: {
        size: "standard",
        stock: "300gsm-matte",
        sides: "single",
        finish: "none",
      },
      quantity: 100,
    };

    const run1 = estimate(samplePricingConfig, input);
    const run2 = estimate(samplePricingConfig, input);

    // Pure function: exact determinism
    expect(run1).toEqual(run2);

    expect(run1.productId).toBe("business-cards");
    expect(run1.quantity).toBe(100);
    expect(run1.currency).toBe("INR");
    expect(run1.pricingConfigVersion).toBe("sample-v1");
    expect(run1.isSample).toBe(true);
    expect(run1.taxIncluded).toBe(false);
    expect(run1.shippingIncluded).toBe(false);

    // Base unit price: 300 paise * 100 = 30000 paise
    // Quantity break for 100 is 5% -> Math.round(300 * 0.05) = 15 paise per unit -> -1500 paise
    // Setup fee: 15000 paise
    // Grand total: 30000 - 1500 + 15000 = 43500 paise (₹435.00)
    expect(run1.total).toBe(43500);

    const baseLine = run1.lineItems.find((l) => l.code === "BASE_PRICE");
    expect(baseLine?.unitAmount).toBe(300);
    expect(baseLine?.lineTotal).toBe(30000);

    const discountLine = run1.lineItems.find(
      (l) => l.code === "QUANTITY_BREAK_DISCOUNT"
    );
    expect(discountLine?.unitAmount).toBe(-15);
    expect(discountLine?.lineTotal).toBe(-1500);

    const setupLine = run1.lineItems.find((l) => l.code === "SETUP_FEE");
    expect(setupLine?.lineTotal).toBe(15000);
  });

  it("applies option adjustments, multipliers, and integer rounding accurately", () => {
    const input = {
      productId: "business-cards",
      options: {
        size: "square", // +40 paise
        stock: "350gsm-gloss", // +50 paise
        sides: "double", // +100 paise + multiplier 1.25x of 300 base (300 * 0.25 = 75 paise) -> total +175 paise
        finish: "spot-uv", // +150 paise, flatFee: 5000 paise
      },
      quantity: 500,
    };

    const breakdown = estimate(samplePricingConfig, input);

    // Check option adjustments line items
    const optionItems = breakdown.lineItems.filter(
      (l) => l.code === "OPTION_ADJUSTMENT"
    );
    expect(optionItems.length).toBe(4);

    // Verify spot-uv includes flat setup fee in line total
    const spotUvLine = optionItems.find((l) => l.description.includes("spot-uv"));
    expect(spotUvLine?.unitAmount).toBe(150);
    // lineTotal: 150 * 500 + 5000 = 75000 + 5000 = 80000
    expect(spotUvLine?.lineTotal).toBe(80000);

    // Total must be integer minor units
    expect(Number.isInteger(breakdown.total)).toBe(true);
    const sumLineTotals = breakdown.lineItems.reduce(
      (acc, item) => acc + item.lineTotal,
      0
    );
    expect(breakdown.total).toBe(sumLineTotals);
  });

  it("accurately switches quantity-break tiers across volume boundaries", () => {
    // Tiers for flyers-brochures: 250: 8%, 500: 15%, 1000: 25%, 5000: 35%
    const baseInput = {
      productId: "flyers-brochures",
      options: {
        size: "a4",
        stock: "130gsm-gloss",
        sides: "single",
        fold: "none",
      },
    };

    // 249 units: below first tier (0% discount)
    const quote249 = estimate(samplePricingConfig, {
      ...baseInput,
      quantity: 249,
    });
    expect(
      quote249.lineItems.some((l) => l.code === "QUANTITY_BREAK_DISCOUNT")
    ).toBe(false);

    // 250 units: exactly at 8% tier
    const quote250 = estimate(samplePricingConfig, {
      ...baseInput,
      quantity: 250,
    });
    const discount250 = quote250.lineItems.find(
      (l) => l.code === "QUANTITY_BREAK_DISCOUNT"
    );
    expect(discount250?.description).toContain("8%");

    // 500 units: at 15% tier
    const quote500 = estimate(samplePricingConfig, {
      ...baseInput,
      quantity: 500,
    });
    const discount500 = quote500.lineItems.find(
      (l) => l.code === "QUANTITY_BREAK_DISCOUNT"
    );
    expect(discount500?.description).toContain("15%");

    // 1000 units: at 25% tier
    const quote1000 = estimate(samplePricingConfig, {
      ...baseInput,
      quantity: 1000,
    });
    const discount1000 = quote1000.lineItems.find(
      (l) => l.code === "QUANTITY_BREAK_DISCOUNT"
    );
    expect(discount1000?.description).toContain("25%");
  });

  it("rejects unknown products with NotFoundError", () => {
    expect(() =>
      estimate(samplePricingConfig, {
        productId: "non-existent-poster",
        options: {},
        quantity: 100,
      })
    ).toThrowError(NotFoundError);
  });

  it("rejects quantities outside allowed min/max range with UnprocessableEntityError", () => {
    // business-cards min is 50, max is 10000
    expect(() =>
      estimate(samplePricingConfig, {
        productId: "business-cards",
        options: {
          size: "standard",
          stock: "300gsm-matte",
          sides: "single",
          finish: "none",
        },
        quantity: 20, // Below minQuantity (50)
      })
    ).toThrowError(UnprocessableEntityError);

    expect(() =>
      estimate(samplePricingConfig, {
        productId: "business-cards",
        options: {
          size: "standard",
          stock: "300gsm-matte",
          sides: "single",
          finish: "none",
        },
        quantity: 50000, // Above maxQuantity (10000)
      })
    ).toThrowError(UnprocessableEntityError);
  });

  it("rejects missing required options with UnprocessableEntityError", () => {
    expect(() =>
      estimate(samplePricingConfig, {
        productId: "business-cards",
        options: {
          size: "standard",
          stock: "300gsm-matte",
          // missing 'sides' and 'finish'
        },
        quantity: 100,
      })
    ).toThrowError(UnprocessableEntityError);
  });

  it("rejects unknown option keys or values with UnprocessableEntityError", () => {
    expect(() =>
      estimate(samplePricingConfig, {
        productId: "business-cards",
        options: {
          size: "giant-size-invalid",
          stock: "300gsm-matte",
          sides: "single",
          finish: "none",
        },
        quantity: 100,
      })
    ).toThrowError(UnprocessableEntityError);
  });

  it("rejects incompatible option combinations as configured in rules", () => {
    // business-cards rule: spot-uv is incompatible with 300gsm-matte
    expect(() =>
      estimate(samplePricingConfig, {
        productId: "business-cards",
        options: {
          size: "standard",
          stock: "300gsm-matte",
          sides: "single",
          finish: "spot-uv",
        },
        quantity: 100,
      })
    ).toThrowError(/Spot UV requires premium cardstock/);

    // flyers-brochures rule: bi-fold incompatible with a5
    expect(() =>
      estimate(samplePricingConfig, {
        productId: "flyers-brochures",
        options: {
          size: "a5",
          stock: "130gsm-gloss",
          sides: "single",
          fold: "bi-fold",
        },
        quantity: 100,
      })
    ).toThrowError(/Bi-fold is not supported on A5/);
  });
});
