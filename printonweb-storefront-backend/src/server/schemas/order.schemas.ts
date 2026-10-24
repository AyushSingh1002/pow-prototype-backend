import { z } from "zod";

export const createOrderHeadersSchema = z
  .object({
    "idempotency-key": z
      .string({ required_error: "Idempotency-Key header is required" })
      .min(1, "Idempotency-Key cannot be empty"),
    authorization: z.string().optional(),
  })
  .passthrough();

export const createOrderBodySchema = z
  .object({
    quoteId: z
      .string({ required_error: "quoteId is required" })
      .uuid("quoteId must be a valid UUID"),
  })
  .strict({ message: "Unknown fields in order creation are rejected." });

export const getOrderParamsSchema = z
  .object({
    id: z.string().uuid("Invalid order ID format. Must be a valid UUID."),
  })
  .strict();
