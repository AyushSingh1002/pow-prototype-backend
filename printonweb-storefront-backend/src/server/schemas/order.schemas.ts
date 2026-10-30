import { z } from "zod";

export const createOrderHeadersSchema = z
  .object({
    "idempotency-key": z
      .string({ error: "Idempotency-Key header is required" })
      .min(1, "Idempotency-Key cannot be empty"),
    authorization: z.string().optional(),
  })
  .passthrough();

export const createOrderBodySchema = z
  .object({
    quoteId: z
      .string({ error: "quoteId is required" })
      .uuid("quoteId must be a valid UUID"),
    contact: z
      .object({
        name: z.string().trim().min(2).max(120),
        phone: z
          .string()
          .trim()
          .transform((value) => value.replace(/\s+/g, ""))
          .pipe(z.string().regex(/^((\+91|91|0)?[6-9]\d{9})$/)),
        address: z.string().trim().min(8).max(500),
        city: z.string().trim().min(2).max(120),
        pincode: z.string().regex(/^\d{6}$/),
      })
      .strict()
      .optional(),
    deliveryMethod: z.enum(["SHIP", "PICKUP"]).optional(),
  })
  .strict();

export const getOrderParamsSchema = z
  .object({
    id: z.string().uuid("Invalid order ID format. Must be a valid UUID."),
  })
  .strict();
