import { describe, expect, it } from "vitest";
import { UnprocessableEntityError } from "../../src/core/errors/AppError";
import { QuoteRecord } from "../../src/modules/quotes/quote.types";
import { ProductionCheckoutPricingService } from "../../src/modules/orders/checkout-pricing.service";

const quote: QuoteRecord = {
  id: "quote-1",
  productId: "product-1",
  validatedOptions: {},
  quantity: 1,
  lineItems: [],
  total: 10_000,
  currency: "INR",
  pricingConfigVersion: "test",
  isSample: false,
  taxIncluded: false,
  shippingIncluded: false,
  expiresAt: "2026-10-25T00:00:00.000Z",
  createdAt: "2026-10-24T00:00:00.000Z",
};

describe("checkout pricing", () => {
  it("charges no shipping for pickup while retaining tax", async () => {
    const pricing = new ProductionCheckoutPricingService(
      '{"gstBasisPoints":1800}',
      undefined,
      undefined
    );

    await expect(pricing.calculate(quote, undefined, "PICKUP")).resolves.toEqual({
      taxAmount: 1800,
      shippingAmount: 0,
      currency: "INR",
    });
  });

  it("requires delivery details when shipping", async () => {
    const pricing = new ProductionCheckoutPricingService(
      '{"gstBasisPoints":1800}',
      undefined,
      undefined
    );

    await expect(pricing.calculate(quote, undefined, "SHIP")).rejects.toBeInstanceOf(
      UnprocessableEntityError
    );
  });
});
