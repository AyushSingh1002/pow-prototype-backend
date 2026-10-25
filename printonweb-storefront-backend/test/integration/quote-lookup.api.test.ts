import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app";
import { InMemoryQuoteRepository } from "../../src/modules/quotes/quote.repository";
import { QuoteRecord } from "../../src/modules/quotes/quote.types";

describe("Quote Lookup API - GET /api/quotes/:id Integration Tests", () => {
  const quoteRepo = new InMemoryQuoteRepository();
  const app = createApp({ quoteRepository: quoteRepo });

  const sampleQuoteRecord: QuoteRecord = {
    id: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    productId: "business-cards",
    validatedOptions: { size: "standard", stock: "300gsm-matte", sides: "single", finish: "none" },
    quantity: 100,
    lineItems: [
      {
        code: "BASE_PRICE",
        description: "Base unit price (business-cards)",
        unitAmount: 300,
        quantity: 100,
        lineTotal: 30000,
      },
    ],
    total: 30000,
    currency: "INR",
    pricingConfigVersion: "sample-v1",
    isSample: true,
    taxIncluded: false,
    shippingIncluded: false,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  };

  it("retrieves an active quote by valid UUID", async () => {
    await quoteRepo.save(sampleQuoteRecord);

    const res = await request(app).get(`/api/quotes/${sampleQuoteRecord.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id", sampleQuoteRecord.id);
    expect(res.body).toHaveProperty("total", 30000);
    expect(res.body).toHaveProperty("pricingConfigVersion", "sample-v1");
    expect(res.body).toHaveProperty("isSample", true);
  });

  it("returns 400 VALIDATION_FAILED when given a malformed non-UUID id", async () => {
    const res = await request(app).get("/api/quotes/not-a-valid-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty("code", "VALIDATION_FAILED");
    expect(res.body.error.details[0].path).toBe("id");
  });

  it("returns 404 QUOTE_NOT_FOUND when quote UUID does not exist", async () => {
    const nonExistentUuid = "99999999-9999-4999-8999-999999999999";
    const res = await request(app).get(`/api/quotes/${nonExistentUuid}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toHaveProperty("code", "QUOTE_NOT_FOUND");
  });

  it("returns 410 QUOTE_EXPIRED when quote expiry timestamp is in the past", async () => {
    const expiredRecord: QuoteRecord = {
      ...sampleQuoteRecord,
      id: "f8e7d6c5-b4a3-2109-8765-43210fedcba9",
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // Expired 1 min ago
    };
    await quoteRepo.save(expiredRecord);

    const res = await request(app).get(`/api/quotes/${expiredRecord.id}`);

    expect(res.status).toBe(410);
    expect(res.body.error).toHaveProperty("code", "QUOTE_EXPIRED");
    expect(res.body.error.message).toContain("has expired");
  });
});
