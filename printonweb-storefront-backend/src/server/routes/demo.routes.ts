import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { StubbedUploadService } from "../../modules/uploads/upload.service";
import { DemoPaymentService } from "../../modules/payments/payment.service";
import { validateRequest } from "../middleware/validate";

const initiateUploadSchema = z
  .object({
    originalFilename: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().positive(),
    slotId: z.enum(["interior", "cover", "primary", "back", "secondary", "cutline", "design_file"]).optional(),
    quoteId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
  })
  .strict();

const demoCheckoutSchema = z
  .object({
    orderId: z.string().uuid(),
    paymentMethod: z.enum(["demo_card", "demo_upi", "demo_netbanking"]),
  })
  .strict();

export function createDemoRouter(
  uploadService: StubbedUploadService,
  paymentService: DemoPaymentService
): Router {
  const router = Router();

  // POST /api/demo/uploads
  router.post(
    "/demo/uploads",
    validateRequest({ body: initiateUploadSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await uploadService.initiateUpload(req.body);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/demo/checkout
  router.post(
    "/demo/checkout",
    validateRequest({ body: demoCheckoutSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await paymentService.processDemoCheckout(req.body);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
