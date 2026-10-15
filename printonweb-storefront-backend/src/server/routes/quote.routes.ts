import { Router, Request, Response, NextFunction } from "express";
import { QuoteService } from "../../modules/quotes/quote.service";
import { validateRequest } from "../middleware/validate";
import {
  createQuoteBodySchema,
  getQuoteParamsSchema,
} from "../schemas/quote.schemas";
import { InMemoryRateLimiter } from "../middleware/rateLimiter";

export function createQuoteRouter(
  quoteService: QuoteService,
  rateLimiter?: InMemoryRateLimiter
): Router {
  const router = Router();

  const rateLimitMiddleware = rateLimiter
    ? rateLimiter.middleware()
    : (_req: Request, _res: Response, next: NextFunction) => next();

  // POST /api/quotes (Rate limited, size-capped, server-computed pricing)
  router.post(
    "/quotes",
    rateLimitMiddleware,
    validateRequest({ body: createQuoteBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const quote = await quoteService.createQuote(req.body);
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
    validateRequest({ params: getQuoteParamsSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const quote = await quoteService.getQuoteById(req.params.id);
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
