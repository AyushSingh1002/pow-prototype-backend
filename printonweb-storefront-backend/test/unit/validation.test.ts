import { describe, it, expect } from "vitest";
import {
  createQuoteBodySchema,
  getQuoteParamsSchema,
} from "../../src/server/schemas/quote.schemas";
import { listProductsQuerySchema } from "../../src/server/schemas/catalogue.schemas";

describe("Validation Schemas - Unit Tests", () => {
  describe("createQuoteBodySchema", () => {
    it("accepts valid input", () => {
      const valid = {
        productId: "business-cards",
        options: { size: "standard", stock: "300gsm-matte" },
        quantity: 100,
      };
      expect(() => createQuoteBodySchema.parse(valid)).not.toThrow();
    });

    it("strictly rejects client-supplied total or extra fields", () => {
      const tampered = {
        productId: "business-cards",
        options: { size: "standard" },
        quantity: 100,
        total: 1000, // Browser trying to supply its own price
        clientDiscount: 50,
      };
      expect(() => createQuoteBodySchema.parse(tampered)).toThrowError(
        /unrecognized_keys|Unknown fields are rejected/i
      );
    });

    it("rejects non-positive and float quantities", () => {
      expect(() =>
        createQuoteBodySchema.parse({
          productId: "business-cards",
          options: {},
          quantity: -10,
        })
      ).toThrow();

      expect(() =>
        createQuoteBodySchema.parse({
          productId: "business-cards",
          options: {},
          quantity: 25.5,
        })
      ).toThrow();
    });
  });

  describe("listProductsQuerySchema", () => {
    it("applies defaults and coerces valid strings to numbers", () => {
      const parsed = listProductsQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(10);

      const parsedExplicit = listProductsQuerySchema.parse({
        page: "3",
        pageSize: "25",
        category: "stationery",
      });
      expect(parsedExplicit.page).toBe(3);
      expect(parsedExplicit.pageSize).toBe(25);
      expect(parsedExplicit.category).toBe("stationery");
    });

    it("enforces maximum pageSize of 50 to prevent unbounded queries", () => {
      expect(() =>
        listProductsQuerySchema.parse({ pageSize: "100" })
      ).toThrowError(/PageSize cannot exceed 50/);
    });
  });

  describe("getQuoteParamsSchema", () => {
    it("accepts valid UUID v4", () => {
      expect(() =>
        getQuoteParamsSchema.parse({
          id: "123e4567-e89b-12d3-a456-426614174000",
        })
      ).not.toThrow();
    });

    it("rejects non-UUID strings", () => {
      expect(() =>
        getQuoteParamsSchema.parse({ id: "invalid-not-a-uuid" })
      ).toThrowError(/Must be a valid UUID/);
    });
  });
});
