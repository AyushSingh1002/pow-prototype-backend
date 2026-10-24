import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app";
import { InMemoryRateLimiter } from "../../src/server/middleware/rateLimiter";

describe("Quotes API - POST /api/quotes Integration Tests", () => {
  const app = createApp();

  const validQuotePayload = {
    productId: "business-cards",
    options: {
      size: "standard",
      stock: "300gsm-matte",
      sides: "single",
      finish: "none",
    },
    quantity: 100,
  };

  it("creates a valid quote and returns auditable server-calculated breakdown", async () => {
    const res = await request(app)
      .post("/api/quotes")
      .send(validQuotePayload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("lineItems");
    expect(res.body).toHaveProperty("total", 43500);
    expect(res.body).toHaveProperty("currency", "INR");
    expect(res.body).toHaveProperty("pricingConfigVersion", "sample-v1");
    expect(res.body).toHaveProperty("isSample", true);
    expect(res.body).toHaveProperty("taxIncluded", false);
    expect(res.body).toHaveProperty("shippingIncluded", false);
    expect(res.body).toHaveProperty("expiresAt");

    // Header checks
    expect(res.headers).toHaveProperty("x-request-id");
  });

  it("accepts business card runs of 10 and rejects quantities below 10", async () => {
    const smallRun = await request(app)
      .post("/api/quotes")
      .send({ ...validQuotePayload, quantity: 10 });
    expect(smallRun.status).toBe(201);

    const belowMinimum = await request(app)
      .post("/api/quotes")
      .send({ ...validQuotePayload, quantity: 9 });
    expect(belowMinimum.status).toBe(422);
    expect(belowMinimum.body.error).toHaveProperty("code", "INVALID_QUANTITY");
  });

  it("allows a single custom book with its own page-count and finish options", async () => {
    const response = await request(app)
      .post("/api/quotes")
      .send({
        productId: "books",
        options: {
          size: "a5-portrait",
          interior: "bw",
          paper: "natural-white",
          binding: "paperback",
          pages: "200",
          finish: "foil",
        },
        quantity: 1,
      });

    expect(response.status).toBe(201);
    expect(response.body.total).toBeGreaterThan(0);
  });

  it("preserves only bounded request IDs with safe characters", async () => {
    const validRes = await request(app)
      .post("/api/quotes")
      .set("x-request-id", "client.trace-01")
      .send(validQuotePayload);
    expect(validRes.headers["x-request-id"]).toBe("client.trace-01");

    const invalidRes = await request(app)
      .post("/api/quotes")
      .set("x-request-id", "x".repeat(65))
      .send(validQuotePayload);
    expect(invalidRes.headers["x-request-id"]).toMatch(/^req_[a-f0-9]{16}$/);
  });

  it("prices book page-count and cover-finish selections on the server", async () => {
    const options = {
      size: "a5-portrait",
      interior: "bw",
      paper: "natural-white",
      binding: "paperback",
      pages: "120",
      finish: "matte",
    };
    const baseline = await request(app)
      .post("/api/quotes")
      .send({ productId: "books", options, quantity: 10 });
    const upgraded = await request(app)
      .post("/api/quotes")
      .send({
        productId: "books",
        options: { ...options, pages: "200", finish: "foil" },
        quantity: 10,
      });

    expect(baseline.status).toBe(201);
    expect(upgraded.status).toBe(201);
    expect(upgraded.body.total).toBeGreaterThan(baseline.body.total);
    expect(upgraded.body.lineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: expect.stringContaining("pages = 200") }),
        expect.objectContaining({ description: expect.stringContaining("finish = foil") }),
      ])
    );
  });

  it("strictly rejects browser-supplied pricing or total fields", async () => {
    const tamperedPayload = {
      ...validQuotePayload,
      total: 50, // Malicious browser attempt to force 50 paise
    };

    const res = await request(app)
      .post("/api/quotes")
      .send(tamperedPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty("code", "VALIDATION_FAILED");
    expect(res.body.error.details[0].path).toBe("total");
  });

  it("rejects invalid body with missing required fields with 400", async () => {
    const res = await request(app)
      .post("/api/quotes")
      .send({
        productId: "business-cards",
        // missing options and quantity
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty("code", "VALIDATION_FAILED");
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it("rejects wrong data types with 400", async () => {
    const res = await request(app)
      .post("/api/quotes")
      .send({
        productId: "business-cards",
        options: { size: "standard" },
        quantity: "one-hundred", // string instead of integer
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty("code", "VALIDATION_FAILED");
    expect(res.body.error.details[0].path).toBe("quantity");
  });

  it("rejects incompatible options combination with 422", async () => {
    const incompatiblePayload = {
      productId: "business-cards",
      options: {
        size: "standard",
        stock: "300gsm-matte", // 300gsm matte is incompatible with spot-uv
        sides: "single",
        finish: "spot-uv",
      },
      quantity: 100,
    };

    const res = await request(app)
      .post("/api/quotes")
      .send(incompatiblePayload);

    expect(res.status).toBe(422);
    expect(res.body.error).toHaveProperty("code", "INCOMPATIBLE_OPTIONS");
    expect(res.body.error.message).toContain("Spot UV requires premium cardstock");
  });

  it("rejects out-of-range quantities with 422", async () => {
    const res = await request(app)
      .post("/api/quotes")
      .send({
        ...validQuotePayload,
        quantity: 9, // Below minQuantity (10)
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toHaveProperty("code", "INVALID_QUANTITY");
  });

  it("enforces Content-Type application/json with 415", async () => {
    const res = await request(app)
      .post("/api/quotes")
      .set("Content-Type", "text/plain")
      .send("raw-unsupported-data");

    expect(res.status).toBe(415);
    expect(res.body.error).toHaveProperty("code", "UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects oversize payloads exceeding MAX_BODY_BYTES with 413", async () => {
    // Generate large dummy string exceeding 102400 bytes
    const hugeString = "x".repeat(105000);

    const res = await request(app)
      .post("/api/quotes")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ dummy: hugeString }));

    expect(res.status).toBe(413);
    expect(res.body.error).toHaveProperty("code", "PAYLOAD_TOO_LARGE");
  });

  it("rate limits rapid requests with 429", async () => {
    // Create an isolated app instance with a tight rate limit for testing
    const tightLimiter = new InMemoryRateLimiter(60000, 3);
    const rateLimitedApp = createApp({ rateLimiter: tightLimiter });

    // Send 3 requests (allowed)
    for (let i = 0; i < 3; i++) {
      const okRes = await request(rateLimitedApp)
        .post("/api/quotes")
        .send(validQuotePayload);
      expect(okRes.status).toBe(201);
    }

    // 4th request must be rejected with 429
    const blockedRes = await request(rateLimitedApp)
      .post("/api/quotes")
      .send(validQuotePayload);

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toHaveProperty("code", "RATE_LIMITED");
  });
});
