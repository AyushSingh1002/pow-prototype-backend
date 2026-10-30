import { OrderRecord } from "../modules/orders/order.types";
import { QuoteRecord } from "../modules/quotes/quote.types";
import { samplePricingConfig } from "./samplePricingConfig";

const createdAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

export const demoStaffQuote: QuoteRecord = {
  id: "20000000-0000-4000-8000-000000000001",
  productId: "business-cards",
  validatedOptions: {
    size: "standard",
    stock: "350gsm-gloss",
    sides: "double",
    finish: "matte-lamination",
  },
  quantity: 500,
  lineItems: [
    {
      code: "BASE_PRICE",
      description: "Business cards",
      unitAmount: 300,
      quantity: 500,
      lineTotal: 150000,
    },
    {
      code: "SETUP_FEE",
      description: "Print setup",
      unitAmount: 15000,
      quantity: 1,
      lineTotal: 15000,
    },
  ],
  total: 165000,
  currency: "INR",
  pricingConfigVersion: samplePricingConfig.version,
  isSample: true,
  taxIncluded: false,
  shippingIncluded: false,
  expiresAt,
  createdAt,
  customerId: "cust_demo_1",
};

export const demoStaffOrder: OrderRecord = {
  id: "10000000-0000-4000-8000-000000000001",
  quoteId: demoStaffQuote.id,
  customerId: "cust_demo_1",
  idempotencyKey: "demo-staff-queue-order",
  status: "CONFIRMED",
  total: demoStaffQuote.total,
  currency: demoStaffQuote.currency,
  createdAt,
  updatedAt: createdAt,
  deliveryMethod: "SHIP",
  contact: {
    name: "Demo Customer",
    phone: "+910000000000",
    address: "Demo address",
    city: "Mumbai",
    pincode: "400001",
  },
};
