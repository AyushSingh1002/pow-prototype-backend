import { z } from "zod";

export const createQuoteBodySchema = z
  .object({
    productId: z.string({ error: "productId is required" }).min(1, "productId cannot be empty"),
    options: z.record(z.string(), z.string()),
    quantity: z
      .number({ error: "quantity is required" })
      .int("quantity must be an integer")
      .positive("quantity must be a positive integer"),
  })
  .strict();

export const getQuoteParamsSchema = z
  .object({
    id: z.string().uuid("Invalid quote ID format. Must be a valid UUID."),
  })
  .strict();
