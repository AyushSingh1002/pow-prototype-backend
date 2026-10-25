import { Router, Request, Response, NextFunction } from "express";
import { OrderService } from "../../modules/orders/order.service";
import { requireAuth } from "../middleware/auth";
import { validateRequest } from "../middleware/validate";
import {
  createOrderHeadersSchema,
  createOrderBodySchema,
  getOrderParamsSchema,
} from "../schemas/order.schemas";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";
import { env } from "../../config/env";

export function createOrderRouter(orderService: OrderService): Router {
  const router = Router();

  // POST /api/orders (Authenticated, requires Idempotency-Key header, body: quoteId)
  router.post(
    "/orders",
    requireAuth,
    validateRequest({
      headers: createOrderHeadersSchema,
      body: createOrderBodySchema,
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const idempotencyKey = req.headers["idempotency-key"] as string;
        const customerId = req.user!.id;
        const quoteId = req.body.quoteId;
        if (!env.ENABLE_DEMO_MODE && !req.body.contact) {
          throw new ValidationError("Delivery contact details are required for production orders.");
        }

        const order = await orderService.createDraftOrder({
          quoteId,
          customerId,
          idempotencyKey,
          contact: req.body.contact,
        });

        res.status(201).json({
          id: order.id,
          status: "draft",
          total: order.total,
          currency: order.currency,
          lineItems: [
            { code: "PRINT", amount: order.total - (order.taxAmount ?? 0) - (order.shippingAmount ?? 0) },
            { code: "TAX", amount: order.taxAmount ?? 0 },
            { code: "SHIPPING", amount: order.shippingAmount ?? 0 },
          ],
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/orders/:id (Authenticated, scoped to customer)
  router.get(
    "/orders/:id",
    validateRequest({ params: getOrderParamsSchema }),
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const order = await orderService.getOrderById(req.params.id);
        if (!order) {
          throw new NotFoundError(
            `Order '${req.params.id}' not found.`,
            ErrorCodes.ORDER_NOT_FOUND
          );
        }

        if (order.customerId !== req.user!.id) {
          throw new ForbiddenError("You do not have permission to view this order.");
        }

        const history = await orderService.getStatusHistory(order.id);

        res.status(200).json({
          order,
          history,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
