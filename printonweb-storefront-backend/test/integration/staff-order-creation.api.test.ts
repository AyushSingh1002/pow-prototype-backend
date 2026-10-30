import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { samplePricingConfig } from "../../src/config/samplePricingConfig";
import { InMemoryOrderRepository } from "../../src/modules/orders/order.repository";
import { OrderService } from "../../src/modules/orders/order.service";
import { estimate } from "../../src/modules/pricing/pricing.engine";
import { InMemoryQuoteRepository } from "../../src/modules/quotes/quote.repository";
import { QuoteService } from "../../src/modules/quotes/quote.service";
import { QuoteRecord } from "../../src/modules/quotes/quote.types";
import {
  PaymentGateway,
  ProductionPaymentService,
  VerifiedPaymentEvent,
} from "../../src/modules/payments/payment.service";
import { StubbedUploadService } from "../../src/modules/uploads/upload.service";
import { createStaffRouter } from "../../src/server/routes/staff.routes";

describe("Staff order creation API", () => {
  it("creates an owned customer order and emails one Razorpay link", async () => {
    const customerId = randomUUID();
    const customer = {
      id: customerId,
      displayName: "Existing Customer",
      email: "customer@example.test",
      phone: "+919876543210",
    };
    const orders = new InMemoryOrderRepository([customer]);
    const quotes = new InMemoryQuoteRepository();
    const estimateResult = estimate(samplePricingConfig, {
      productId: "business-cards",
      options: {
        size: "standard",
        stock: "300gsm-matte",
        sides: "single",
        finish: "none",
      },
      quantity: 100,
    });
    const quote: QuoteRecord = {
      id: randomUUID(),
      productId: estimateResult.productId,
      validatedOptions: {
        size: "standard",
        stock: "300gsm-matte",
        sides: "single",
        finish: "none",
      },
      quantity: 100,
      lineItems: estimateResult.lineItems,
      total: estimateResult.total,
      currency: estimateResult.currency,
      pricingConfigVersion: estimateResult.pricingConfigVersion,
      isSample: false,
      taxIncluded: false,
      shippingIncluded: false,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      customerId,
    };
    await quotes.save(quote);
    const orderService = new OrderService(orders, quotes, samplePricingConfig);
    const createPaymentLink = vi.fn(async () => ({
      paymentLinkId: "plink_staff_order",
      shortUrl: "https://rzp.io/i/plink_staff_order",
    }));
    const gateway: PaymentGateway = {
      createOrder: async () => { throw new Error("Not used by staff payment links."); },
      createPaymentLink,
      verifyWebhook: (_body, _signature, _eventId): VerifiedPaymentEvent => {
        throw new Error("Not used by staff order creation.");
      },
    };
    const payments = new ProductionPaymentService(gateway, orders, orderService);
    const app = express();
    app.use(express.json());
    app.use(createStaffRouter(
      orderService,
      new StubbedUploadService(),
      new QuoteService(quotes, samplePricingConfig),
      payments,
    ));

    const customerSearch = await request(app)
      .get("/staff/customers")
      .query({ query: "customer@example.test" })
      .set("Authorization", "Bearer demo-staff-token");
    expect(customerSearch.status).toBe(200);
    expect(customerSearch.body.customers).toHaveLength(1);
    const customerQuotes = await request(app)
      .get(`/staff/customers/${customerId}/quotes`)
      .set("Authorization", "Bearer demo-staff-token");
    expect(customerQuotes.status).toBe(200);
    expect(customerQuotes.body.quotes).toHaveLength(1);

    const createRequest = () => request(app)
      .post("/staff/orders")
      .set("Authorization", "Bearer demo-staff-token")
      .set("Idempotency-Key", "staff-create-order-1")
      .send({
        customerId,
        quoteId: quote.id,
        deliveryMethod: "SHIP",
        contact: {
          name: "Existing Customer",
          phone: "+919876543210",
          address: "12 Example Market",
          city: "New Delhi",
          pincode: "110001",
        },
      });
    const first = await createRequest();
    const replay = await createRequest();

    expect(first.status).toBe(201);
    expect(first.body.order.status).toBe("SUBMITTED");
    expect(first.body.paymentLink.shortUrl).toBe("https://rzp.io/i/plink_staff_order");
    expect(first.body.emailQueued).toBe(true);
    expect(replay.status).toBe(201);
    expect(replay.body.order.id).toBe(first.body.order.id);
    expect(createPaymentLink).toHaveBeenCalledTimes(1);
  });
});
