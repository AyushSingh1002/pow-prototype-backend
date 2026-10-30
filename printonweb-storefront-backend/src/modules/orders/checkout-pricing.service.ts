import { env } from "../../config/env";
import { ServiceUnavailableError, UnprocessableEntityError } from "../../core/errors/AppError";
import { QuoteRecord } from "../quotes/quote.types";
import { DeliveryContact } from "./order.types";

export interface CheckoutCharges {
  taxAmount: number;
  shippingAmount: number;
  currency: string;
}

export interface ICheckoutPricingService {
  calculate(
    quote: QuoteRecord,
    contact: DeliveryContact | undefined,
    deliveryMethod: "SHIP" | "PICKUP"
  ): Promise<CheckoutCharges>;
}

interface TaxRules {
  gstBasisPoints: number;
}

export class ProductionCheckoutPricingService implements ICheckoutPricingService {
  constructor(
    private readonly taxRulesJson = env.TAX_RULES_CONFIG,
    private readonly shippingProviderUrl = env.SHIPPING_PROVIDER_URL,
    private readonly providerToken = env.SHIPPING_PROVIDER_TOKEN
  ) {}

  async calculate(
    quote: QuoteRecord,
    contact: DeliveryContact | undefined,
    deliveryMethod: "SHIP" | "PICKUP"
  ): Promise<CheckoutCharges> {
    const rules = parseTaxRules(this.taxRulesJson);
    if (deliveryMethod === "PICKUP") {
      return {
        taxAmount: Math.round((quote.total * rules.gstBasisPoints) / 10_000),
        shippingAmount: 0,
        currency: quote.currency,
      };
    }
    if (!contact) {
      throw new UnprocessableEntityError("Delivery details are required for shipping.");
    }
    if (!this.shippingProviderUrl || !this.providerToken) {
      throw new ServiceUnavailableError("Shipping-rate provider is not configured.");
    }

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(this.shippingProviderUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.providerToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          quoteId: quote.id,
          productId: quote.productId,
          quantity: quote.quantity,
          destination: {
            city: contact.city,
            pincode: contact.pincode,
          },
          currency: quote.currency,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ServiceUnavailableError("Shipping-rate provider is unavailable.");
    }

    if (!response.ok) {
      throw new ServiceUnavailableError("Shipping-rate provider rejected the rate request.");
    }
    const rate: unknown = await response.json();
    if (!isRecord(rate)) {
      throw new ServiceUnavailableError("Shipping-rate provider returned an invalid rate.");
    }
    const amount = rate.amount;
    const currency = rate.currency;
    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      currency !== quote.currency
    ) {
      throw new ServiceUnavailableError("Shipping-rate provider returned an invalid rate.");
    }

    return {
      taxAmount: Math.round((quote.total * rules.gstBasisPoints) / 10_000),
      shippingAmount: amount,
      currency: quote.currency,
    };
  }
}

function parseTaxRules(value?: string): TaxRules {
  if (!value) throw new ServiceUnavailableError("Approved tax rules are not configured.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ServiceUnavailableError("Tax rules configuration is invalid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new UnprocessableEntityError(
      "Tax rules must define an approved gstBasisPoints integer between 0 and 10000."
    );
  }
  const gstBasisPoints = parsed.gstBasisPoints;
  if (
    typeof gstBasisPoints !== "number" ||
    !Number.isSafeInteger(gstBasisPoints) ||
    gstBasisPoints < 0 ||
    gstBasisPoints > 10_000
  ) {
    throw new UnprocessableEntityError(
      "Tax rules must define an approved gstBasisPoints integer between 0 and 10000."
    );
  }
  return { gstBasisPoints };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
