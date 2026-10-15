import { z } from "zod";

export const listProductsQuerySchema = z
  .object({
    page: z
      .string()
      .optional()
      .default("1")
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().int().positive({ message: "Page must be a positive integer" })),
    pageSize: z
      .string()
      .optional()
      .default("10")
      .transform((val) => parseInt(val, 10))
      .pipe(
        z
          .number()
          .int()
          .positive({ message: "PageSize must be a positive integer" })
          .max(50, { message: "PageSize cannot exceed 50" })
      ),
    category: z.string().trim().min(1).optional(),
  })
  .strict();

export const printOptionsQuerySchema = z
  .object({
    productId: z.string().trim().min(1).optional(),
  })
  .strict();
