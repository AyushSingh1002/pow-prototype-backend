import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app";
import { InMemoryQuoteRepository } from "../../src/modules/quotes/quote.repository";
import { InMemoryOrderRepository } from "../../src/modules/orders/order.repository";
import { QuoteRecord } from "../../src/modules/quotes/quote.types";
import { samplePricingConfig } from "../../src/config/samplePricingConfig";

describe("Orders API - POST /api/orders Integration Tests", () => {
  const quoteRepo = new InMemoryQuoteRepository();
  const orderRepo = new InMemoryOrderRepository();
  const app = createApp({
    quoteRepository: quoteRepo,
    orderRepository: orderRepo,
  });

  const validQuoteId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  const activeQuote: QuoteRecord = {
    id: validQuoteId,
    productId: "business-cards",
    validatedOptions: {
      size: "standard",
      stock: "300gsm-matte",
      sides: "single",
      finish: "none",
    },
    quantity: 100,
    lineItems: [
      {
        code: "BASE_PRICE",
        description: "Base unit price (business-cards)",
        unitAmount: 300,
        quantity: 100,
        lineTotal: 30000,
      },
      {
        code: "QUANTITY_BREAK_DISCOUNT",
        description: "Quantity break discount (5% off unit price for >= 100 units)",
        unitAmount: -15,
        quantity: 100,
        lineTotal: -1500,
      },
      {
        code: "SETUP_FEE",
        description: "Pre-press plate, calibration and setup fee",
        unitAmount: 15000,
        quantity: 1,
        lineTotal: 15000,
      },
    ],
    total: 43500, // Matches computed: 30000 - 1500 + 15000 = 43500
    currency: "INR",
    pricingConfigVersion: "sample-v1",
    isSample: true,
    taxIncluded: false,
    shippingIncluded: false,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  };

  it("rejects unauthenticated request with 401 UNAUTHORIZED", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Idempotency-Key", "test-key-1")
      .send({ quoteId: validQuoteId });

    expect(res.status).toBe(401);
    expect(res.body.error).toHaveProperty("code", "UNAUTHORIZED");
  });

  it("rejects blocked accounts with 403 FORBIDDEN", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer blocked-token")
      .set("Idempotency-Key", "test-key-1")
      .send({ quoteId: validQuoteId });

    expect(res.status).toBe(403);
    expect(res.body.error).toHaveProperty("code", "FORBIDDEN");
  });

  it("rejects missing Idempotency-Key header with 400", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer demo-token")
      .send({ quoteId: validQuoteId });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty("code", "VALIDATION_FAILED");
  });

  it("converts a valid quote to a draft order and creates history row", async () => {
    await quoteRepo.save(activeQuote);

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer demo-token")
      .set("Idempotency-Key", "order-key-100")
      .send({ quoteId: validQuoteId });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("status", "draft");

    // Verify persisted order and audit history
    const orderHistory = await orderRepo.getStatusHistory(res.body.id);
    expect(orderHistory.length).toBe(1);
    expect(orderHistory[0].toStatus).toBe("DRAFT");
    expect(orderHistory[0].fromStatus).toBeNull();
  });

  it("handles idempotent replay safely when called with same key and quote", async () => {
    const firstRes = await request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer demo-token")
      .set("Idempotency-Key", "order-key-100")
      .send({ quoteId: validQuoteId });

    expect(firstRes.status).toBe(201);

    // Replay exact same request
    const replayRes = await request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer demo-token")
      .set("Idempotency-Key", "order-key-100")
      .send({ quoteId: validQuoteId });

    expect(replayRes.status).toBe(201);
    expect(replayRes.body.id).toBe(firstRes.body.id);
  });

  it("rejects duplicate idempotency key used with conflicting quoteId with 409", async () => {
    const otherQuoteId = "44444444-4444-4444-4444-444444444444";
    await quoteRepo.save({
      ...activeQuote,
      id: otherQuoteId,
    });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer demo-token")
      .set("Idempotency-Key", "order-key-100") // reused key with different quote
      .send({ quoteId: otherQuoteId });

    expect(res.status).toBe(409);
    expect(res.body.error).toHaveProperty("code", "DUPLICATE_IDEMPOTENCY_KEY");
  });

  it("rejects conversion of expired quote with 410 QUOTE_EXPIRED", async () => {
    const expiredQuoteId = "55555555-5555-5555-5555-555555555555";
    await quoteRepo.save({
      ...activeQuote,
      id: expiredQuoteId,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer demo-token")
      .set("Idempotency-Key", "order-key-expired-test")
      .send({ quoteId: expiredQuoteId });

    expect(res.status).toBe(410);
    expect(res.body.error).toHaveProperty("code", "QUOTE_EXPIRED");
  });

  it("rejects order creation if pricing formula changed since quote was generated with 422 PRICE_MISMATCH", async () => {
    const tamperedPriceQuoteId = "66666666-6666-6666-6666-666666666666";
    await quoteRepo.save({
      ...activeQuote,
      id: tamperedPriceQuoteId,
      total: 99999, // Stored total is arbitrarily altered / outdated
    });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer demo-token")
      .set("Idempotency-Key", "order-key-price-mismatch")
      .send({ quoteId: tamperedPriceQuoteId });

    expect(res.status).toBe(422);
    expect(res.body.error).toHaveProperty("code", "PRICE_MISMATCH");
    expect(res.body.error.message).toContain("does not match current computed price");
  });
});
