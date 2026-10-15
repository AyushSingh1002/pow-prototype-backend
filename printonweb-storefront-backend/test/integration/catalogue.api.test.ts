import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app";

describe("Catalogue API - Integration Tests", () => {
  const app = createApp();

  describe("GET /api/products", () => {
    it("returns paginated products with default page and pageSize", async () => {
      const res = await request(app).get("/api/products");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("page", 1);
      expect(res.body).toHaveProperty("pageSize", 10);
      expect(res.body).toHaveProperty("total");
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      // Verify product shape
      const first = res.body.data[0];
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("name");
      expect(first).toHaveProperty("category");
      expect(first).toHaveProperty("isSample", true);
    });

    it("filters products by category", async () => {
      const res = await request(app).get("/api/products?category=stationery");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every((p: { category: string }) => p.category === "stationery")
      ).toBe(true);
    });

    it("returns empty data array for non-matching category filter", async () => {
      const res = await request(app).get("/api/products?category=automotive");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it("enforces pagination bounds: rejects pageSize > 50 with 400", async () => {
      const res = await request(app).get("/api/products?pageSize=100");

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty("code", "VALIDATION_FAILED");
      expect(res.body.error.details[0].path).toBe("pageSize");
      expect(res.body.error.details[0].issue).toContain("PageSize cannot exceed 50");
    });
  });

  describe("GET /api/print-options", () => {
    it("returns all print options when no productId query is provided", async () => {
      const res = await request(app).get("/api/print-options");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("filters print options by valid productId", async () => {
      const res = await request(app).get("/api/print-options?productId=business-cards");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every(
          (opt: { productId: string }) => opt.productId === "business-cards"
        )
      ).toBe(true);
    });

    it("returns 404 PRODUCT_NOT_FOUND when productId is unknown", async () => {
      const res = await request(app).get("/api/print-options?productId=unknown-product");

      expect(res.status).toBe(404);
      expect(res.body.error).toHaveProperty("code", "PRODUCT_NOT_FOUND");
      expect(res.body.error.message).toContain("not found in catalogue");
    });
  });
});
