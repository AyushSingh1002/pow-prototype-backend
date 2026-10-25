import { Router, Request, Response, NextFunction } from "express";
import { QuoteService } from "../../modules/quotes/quote.service";
import { validateRequest } from "../middleware/validate";
import {
  createQuoteBodySchema,
  getQuoteParamsSchema,
} from "../schemas/quote.schemas";
import { InMemoryRateLimiter } from "../middleware/rateLimiter";
import { requireAuth } from "../middleware/auth";
import { env } from "../../config/env";
import { ForbiddenError } from "../../core/errors/AppError";

export function createQuoteRouter(
  quoteService: QuoteService,
  rateLimiter?: InMemoryRateLimiter
): Router {
  const router = Router();

  const rateLimitMiddleware = rateLimiter
    ? rateLimiter.middleware()
    : (_req: Request, _res: Response, next: NextFunction) => next();
  const optionalProductionAuth = env.ENABLE_DEMO_MODE
    ? (_req: Request, _res: Response, next: NextFunction) => next()
    : requireAuth;

  // POST /api/quotes (Rate limited, size-capped, server-computed pricing)
  router.post(
    "/quotes",
    rateLimitMiddleware,
    optionalProductionAuth,
    validateRequest({ body: createQuoteBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const quote = await quoteService.createQuote({
          ...req.body,
          customerId: req.user?.id,
        });
        res.status(201).json({
          id: quote.id,
          lineItems: quote.lineItems,
          total: quote.total,
          currency: quote.currency,
          expiresAt: quote.expiresAt,
          pricingConfigVersion: quote.pricingConfigVersion,
          isSample: quote.isSample,
          taxIncluded: quote.taxIncluded,
          shippingIncluded: quote.shippingIncluded,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/quotes/:id (UUID path param)
  router.get(
    "/quotes/:id",
    optionalProductionAuth,
    validateRequest({ params: getQuoteParamsSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const quote = await quoteService.getQuoteById(req.params.id);
        if (quote.customerId && quote.customerId !== req.user?.id) {
          throw new ForbiddenError("You do not have permission to view this quote.");
        }
        res.status(200).json({
          id: quote.id,
          lineItems: quote.lineItems,
          total: quote.total,
          currency: quote.currency,
          expiresAt: quote.expiresAt,
          pricingConfigVersion: quote.pricingConfigVersion,
          isSample: quote.isSample,
          taxIncluded: quote.taxIncluded,
          shippingIncluded: quote.shippingIncluded,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
