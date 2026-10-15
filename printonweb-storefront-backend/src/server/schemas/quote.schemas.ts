import { z } from "zod";

export const createQuoteBodySchema = z
  .object({
    productId: z.string({ required_error: "productId is required" }).min(1, "productId cannot be empty"),
    options: z.record(z.string(), z.string(), {
      required_error: "options object is required",
    }),
    quantity: z
      .number({ required_error: "quantity is required" })
      .int("quantity must be an integer")
      .positive("quantity must be a positive integer"),
  })
  .strict({ message: "Unknown fields are rejected. Client cannot submit pricing or extraneous fields." });

export const getQuoteParamsSchema = z
  .object({
    id: z.string().uuid("Invalid quote ID format. Must be a valid UUID."),
  })
  .strict();
