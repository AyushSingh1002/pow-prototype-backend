import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { IProductionUploadService } from "../../modules/uploads/upload.service";
import { ForbiddenError } from "../../core/errors/AppError";
import { QuoteService } from "../../modules/quotes/quote.service";
import { requireAuth } from "../middleware/auth";
import { validateRequest } from "../middleware/validate";

const initiateSchema = z
  .object({
    originalFilename: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/tiff", "image/png", "image/jpeg"]),
    sizeBytes: z.number().int().positive(),
    quoteId: z.string().uuid(),
    slotId: z.enum(["interior", "cover", "primary", "back", "secondary", "cutline", "design_file"]),
  })
  .strict();

const fileParams = z.object({ id: z.string().uuid() }).strict();

export function createUploadRouter(
  uploads: IProductionUploadService,
  quotes: QuoteService
): Router {
  const router = Router();

  router.post(
    "/uploads",
    requireAuth,
    validateRequest({ body: initiateSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const quote = await quotes.getQuoteById(req.body.quoteId);
        if (!quote.customerId || quote.customerId !== req.user!.id) {
          throw new ForbiddenError("You do not have permission to upload artwork to this quote.");
        }
        const result = await uploads.initiateUploadForCustomer(req.body, req.user!.id);
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/uploads/:id/complete",
    requireAuth,
    validateRequest({ params: fileParams }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const file = await uploads.completeUpload(req.params.id, req.user!.id);
        res.status(200).json({
          fileId: file.id,
          status: file.status,
          preflight: file.preflight,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/uploads/:id/download",
    requireAuth,
    validateRequest({ params: fileParams }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const url = await uploads.createReadUrl(req.params.id, req.user!.id);
        res.status(200).json({ url, expiresInSeconds: 300 });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
