import { z } from "zod";

export const staffOrderParamsSchema = z.object({
  id: z.string().uuid("Invalid order ID format."),
}).strict();

export const staffNoteBodySchema = z.object({
  note: z.string().trim().min(1).max(2000),
}).strict();

export const notificationParamsSchema = z.object({
  id: z.string().uuid("Invalid notification ID format."),
}).strict();

export const staffAssignmentBodySchema = z.object({
  staffId: z.string().uuid("Staff ID must be a valid Supabase user ID."),
}).strict();

export const staffCustomerSearchSchema = z.object({
  query: z.string().trim().min(3).max(80),
}).strict();

export const staffCustomerParamsSchema = z.object({
  id: z.string().uuid("Customer ID must be a valid Supabase user ID."),
}).strict();

export const staffCreateOrderBodySchema = z.object({
  customerId: z.string().uuid(),
  quoteId: z.string().uuid(),
  deliveryMethod: z.literal("SHIP"),
  contact: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().transform((value) => value.replace(/\s+/g, ""))
      .pipe(z.string().regex(/^((\+91|91|0)?[6-9]\d{9})$/)),
    address: z.string().trim().min(8).max(500),
    city: z.string().trim().min(2).max(120),
    pincode: z.string().regex(/^\d{6}$/),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.deliveryMethod === "SHIP" && !value.contact) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contact"],
      message: "Delivery contact is required for shipping orders.",
    });
  }
});
