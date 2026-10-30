import { NextFunction, Request, Response, Router } from "express";
import { OrderService } from "../../modules/orders/order.service";
import { QuoteService } from "../../modules/quotes/quote.service";
import { ProductionPaymentService } from "../../modules/payments/payment.service";
import { IUploadService, IProductionUploadService } from "../../modules/uploads/upload.service";
import { ForbiddenError, NotFoundError, ValidationError } from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";
import { requireStaffAuth } from "../middleware/auth";
import { validateRequest } from "../middleware/validate";
import {
  notificationParamsSchema,
  staffAssignmentBodySchema,
  staffNoteBodySchema,
  staffOrderParamsSchema,
  staffCustomerSearchSchema,
  staffCustomerParamsSchema,
  staffCreateOrderBodySchema,
} from "../schemas/staff.schemas";

export function createStaffRouter(
  orderService: OrderService,
  uploadService: IUploadService,
  quoteService?: QuoteService,
  paymentService?: ProductionPaymentService
): Router {
  const router = Router();
  const requireStaff = requireStaffAuth(orderService);

  if (quoteService && paymentService) {
    router.get(
      "/staff/customers",
      requireStaff,
      validateRequest({ query: staffCustomerSearchSchema }),
      async (req, res, next) => {
        try {
          res.status(200).json({
            customers: await orderService.searchStaffCustomers(req.query.query as string),
          });
        } catch (error) {
          next(error);
        }
      }
    );

    router.get(
      "/staff/customers/:id/quotes",
      requireStaff,
      validateRequest({ params: staffCustomerParamsSchema }),
      async (req, res, next) => {
        try {
          const customer = await orderService.getStaffCustomer(req.params.id);
          if (!customer) {
            throw new NotFoundError("Customer account not found.", ErrorCodes.ORDER_NOT_FOUND);
          }
          res.status(200).json({
            quotes: await quoteService.listActiveCustomerQuotes(customer.id),
          });
        } catch (error) {
          next(error);
        }
      }
    );

    router.post(
      "/staff/orders",
      requireStaff,
      validateRequest({ body: staffCreateOrderBodySchema }),
      async (req, res, next) => {
        try {
          const idempotencyKey = req.header("Idempotency-Key");
          if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
            throw new ValidationError("A valid Idempotency-Key header is required.");
          }
          const customer = await orderService.getStaffCustomer(req.body.customerId);
          if (!customer) {
            throw new NotFoundError("Customer account not found.", ErrorCodes.ORDER_NOT_FOUND);
          }
          const quote = await quoteService.getQuoteById(req.body.quoteId);
          if (quote.customerId !== customer.id || quote.isSample) {
            throw new ForbiddenError("Select an active production quote owned by this customer.");
          }
          const order = await orderService.createDraftOrder({
            quoteId: quote.id,
            customerId: customer.id,
            idempotencyKey,
            deliveryMethod: req.body.deliveryMethod,
            contact: req.body.contact,
          });
          const paymentLink = await paymentService.createPaymentLink(order.id, customer);
          res.status(201).json({
            order: {
              id: order.id,
              status: "SUBMITTED",
              total: order.total,
              currency: order.currency,
            },
            paymentLink,
            emailQueued: true,
          });
        } catch (error) {
          next(error);
        }
      }
    );
  }

  router.get("/staff/accounts", requireStaff, async (req, res, next) => {
    try {
      if (req.staff!.role !== "admin") {
        throw new ForbiddenError("Only an admin can view staff assignment options.");
      }
      res.status(200).json({ staff: await orderService.listStaffAccounts(req.staff!.id) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/staff/orders", requireStaff, async (req, res, next) => {
    try {
      const allowedStatuses = new Set(["CONFIRMED", "IN_PRODUCTION", "COMPLETED"]);
      const requestedStatus = typeof req.query.status === "string" ? req.query.status : undefined;
      if (requestedStatus && !allowedStatuses.has(requestedStatus)) {
        throw new ValidationError("Status must be CONFIRMED, IN_PRODUCTION, or COMPLETED.");
      }
      const orders = await orderService.listStaffOrders(req.staff!.id);
      const filtered = requestedStatus
        ? orders.filter((order) => order.status === requestedStatus)
        : orders;
      const sorted = [...filtered].sort((a, b) => {
        if (!a.deadline && !b.deadline) return a.confirmedAt.localeCompare(b.confirmedAt);
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
      });
      res.status(200).json({
        orders: sorted,
        failedNotifications: await orderService.listDeadNotifications(req.staff!.id),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/staff/orders/:id",
    requireStaff,
    validateRequest({ params: staffOrderParamsSchema }),
    async (req, res, next) => {
      try {
        const order = await orderService.getStaffOrderDetails(req.params.id, req.staff!.id);
        if (!order) {
          throw new NotFoundError(`Order '${req.params.id}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
        }
        const artwork = isProductionUploadService(uploadService)
          ? await Promise.all(order.artworkFiles.map(async (file) => ({
              slotId: file.slotId,
              signedUrl: await uploadService.createReadUrl(file.fileId, order.customerId),
              expiresInSeconds: 300,
            })))
          : [];
        res.status(200).json({
          order: {
            ...order,
            artworkFiles: artwork,
          },
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/staff/orders/:id/claim",
    requireStaff,
    validateRequest({ params: staffOrderParamsSchema }),
    async (req, res, next) => {
      try {
        const order = await orderService.transitionStatus(
          {
            orderId: req.params.id,
            toStatus: "IN_PRODUCTION",
            reason: `Claimed by ${req.staff!.displayName}`,
          },
          { actingStaffId: req.staff!.id }
        );
        res.status(200).json({ order });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/staff/orders/:id/release",
    requireStaff,
    validateRequest({ params: staffOrderParamsSchema }),
    async (req, res, next) => {
      try {
        const order = await orderService.releaseOrder(
          req.params.id,
          req.staff!.id,
          req.staff!.role === "admin"
        );
        res.status(200).json({ order });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/staff/orders/:id/assign",
    requireStaff,
    validateRequest({
      params: staffOrderParamsSchema,
      body: staffAssignmentBodySchema,
    }),
    async (req, res, next) => {
      try {
        if (req.staff!.role !== "admin") {
          throw new ForbiddenError("Only an admin can reassign production orders.");
        }
        const order = await orderService.transitionStatus(
          {
            orderId: req.params.id,
            toStatus: "IN_PRODUCTION",
            reason: "Reassigned by admin",
          },
          {
            actingStaffId: req.staff!.id,
            isAdmin: true,
            reassignToStaffId: req.body.staffId,
          }
        );
        res.status(200).json({ order });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/staff/orders/:id/complete",
    requireStaff,
    validateRequest({ params: staffOrderParamsSchema }),
    async (req, res, next) => {
      try {
        const order = await orderService.transitionStatus(
          {
            orderId: req.params.id,
            toStatus: "COMPLETED",
            reason: `Completed by ${req.staff!.displayName}`,
          },
          {
            actingStaffId: req.staff!.id,
            isAdmin: req.staff!.role === "admin",
          }
        );
        res.status(200).json({ order });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/staff/orders/:id/problems",
    requireStaff,
    validateRequest({ params: staffOrderParamsSchema, body: staffNoteBodySchema }),
    async (req, res, next) => {
      try {
        await orderService.flagProblem(
          req.params.id,
          req.staff!.id,
          req.body.note,
          false
        );
        res.status(201).json({ message: "Problem note recorded." });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/staff/notifications/:id/retry",
    requireStaff,
    validateRequest({ params: notificationParamsSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (req.staff!.role !== "admin") {
          throw new ForbiddenError("Only an admin can retry a failed notification.");
        }
        if (!(await orderService.retryNotification(req.params.id, req.staff!.id))) {
          throw new NotFoundError("Dead notification job not found.", ErrorCodes.ORDER_NOT_FOUND);
        }
        res.status(202).json({ status: "PENDING" });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

function isProductionUploadService(service: IUploadService): service is IProductionUploadService {
  return "createReadUrl" in service;
}
