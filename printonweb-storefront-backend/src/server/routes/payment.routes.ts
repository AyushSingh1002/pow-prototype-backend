import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import { z } from "zod";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";
import { ProductionPaymentService } from "../../modules/payments/payment.service";
import { OrderService } from "../../modules/orders/order.service";
import { requireAuth } from "../middleware/auth";
import { validateRequest } from "../middleware/validate";

const createPaymentSchema = z.object({ orderId: z.string().uuid() }).strict();

export function createPaymentRouter(
  payments: ProductionPaymentService,
  orders: OrderService
): Router {
  const router = Router();

  router.post(
    "/payments/orders",
    express.json(),
    requireAuth,
    validateRequest({ body: createPaymentSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const order = await orders.getOrderById(req.body.orderId);
        if (!order) {
          throw new NotFoundError("Order not found.", ErrorCodes.ORDER_NOT_FOUND);
        }
        if (order.customerId !== req.user!.id) {
          throw new ForbiddenError("You do not have permission to pay for this order.");
        }
        const paymentOrder = await payments.createPaymentOrder(order.id);
        res.status(201).json(paymentOrder);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/webhooks/razorpay",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        if (!Buffer.isBuffer(rawBody)) {
          throw new ValidationError("Webhook body must be raw JSON bytes.");
        }
        const result = await payments.processWebhook(
          rawBody,
          req.header("x-razorpay-signature"),
          req.header("x-razorpay-event-id")
        );
        res.status(200).json({ status: result });
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error("Rejected Razorpay webhook:", error.message);
          res.status(400).json({
            error: { code: error.code, message: error.message, requestId: req.id },
          });
          return;
        }
        if (error instanceof ConflictError) {
          res.status(409).json({
            error: { code: error.code, message: error.message, requestId: req.id },
          });
          return;
        }
        if (error instanceof Error) {
          console.error("Razorpay webhook processing failed:", error.message);
        }
        next(error);
      }
    }
  );

  return router;
}
