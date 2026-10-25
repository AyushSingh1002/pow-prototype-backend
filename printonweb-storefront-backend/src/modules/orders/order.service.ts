import { randomUUID } from "node:crypto";
import { IOrderRepository } from "./order.repository";
import { CreateOrderDTO, OrderRecord, TransitionOrderDTO } from "./order.types";
import { IQuoteRepository } from "../quotes/quote.repository";
import { PricingConfig } from "../pricing/pricing.types";
import { estimate } from "../pricing/pricing.engine";
import { assertValidTransition } from "./order.state-machine";
import { ICheckoutPricingService } from "./checkout-pricing.service";
import { ServiceUnavailableError } from "../../core/errors/AppError";
import {
  NotFoundError,
  GoneError,
  ConflictError,
  UnprocessableEntityError,
} from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";

export class OrderService {
  constructor(
    private readonly orderRepository: IOrderRepository,
    private readonly quoteRepository: IQuoteRepository,
    private readonly pricingConfig: PricingConfig,
    private readonly checkoutPricing?: ICheckoutPricingService
  ) {}

  async createDraftOrder(dto: CreateOrderDTO): Promise<OrderRecord> {
    // 1. Idempotency Check
    const existing = await this.orderRepository.findByCustomerIdAndIdempotencyKey(
      dto.customerId,
      dto.idempotencyKey
    );

    if (existing) {
      if (
        existing.quoteId === dto.quoteId &&
        sameContact(existing.contact, dto.contact)
      ) {
        // Safe idempotent replay
        return existing;
      }
      throw new ConflictError(
        "Idempotency key was previously used with different order parameters.",
        ErrorCodes.DUPLICATE_IDEMPOTENCY_KEY
      );
    }

    // 2. Fetch Stored Quote
    const quote = await this.quoteRepository.findById(dto.quoteId);
    if (!quote) {
      throw new NotFoundError(
        `Quote '${dto.quoteId}' not found.`,
        ErrorCodes.QUOTE_NOT_FOUND
      );
    }
    if (
      (!this.pricingConfig.isSample && quote.customerId !== dto.customerId) ||
      (quote.customerId && quote.customerId !== dto.customerId)
    ) {
      throw new UnprocessableEntityError(
        "Quote does not belong to the authenticated customer.",
        ErrorCodes.FORBIDDEN
      );
    }
    if (!this.pricingConfig.isSample && quote.isSample) {
      throw new UnprocessableEntityError(
        "Sample quotes cannot be used for production orders.",
        ErrorCodes.PRICE_MISMATCH
      );
    }

    // Check expiry
    if (new Date(quote.expiresAt) <= new Date()) {
      throw new GoneError(
        `Quote '${dto.quoteId}' has expired and cannot be converted to an order.`,
        ErrorCodes.QUOTE_EXPIRED
      );
    }

    function sameContact(
      existing: OrderRecord["contact"],
      requested: CreateOrderDTO["contact"]
    ): boolean {
      return (
        existing?.name === requested?.name &&
        existing?.phone === requested?.phone &&
        existing?.address === requested?.address &&
        existing?.city === requested?.city &&
        existing?.pincode === requested?.pincode
      );
    }

    // 3. Recompute Price From Stored Inputs (Auditable Integrity Rule)
    const recomputed = estimate(this.pricingConfig, {
      productId: quote.productId,
      options: quote.validatedOptions,
      quantity: quote.quantity,
    });

    if (recomputed.total !== quote.total) {
      throw new UnprocessableEntityError(
        `Quote price (${quote.total}) does not match current computed price (${recomputed.total}).`,
        ErrorCodes.PRICE_MISMATCH
      );
    }

    if (dto.contact && !this.checkoutPricing && !this.pricingConfig.isSample) {
      throw new ServiceUnavailableError("Production checkout pricing is not configured.");
    }
    const charges = dto.contact && this.checkoutPricing
      ? await this.checkoutPricing.calculate(quote, dto.contact)
      : { taxAmount: 0, shippingAmount: 0, currency: recomputed.currency };
    if (charges.currency !== recomputed.currency) {
      throw new UnprocessableEntityError(
        "Tax and shipping currency must match the quoted currency.",
        ErrorCodes.PRICE_MISMATCH
      );
    }
    const finalTotal = recomputed.total + charges.taxAmount + charges.shippingAmount;
    if (!Number.isSafeInteger(finalTotal)) {
      throw new UnprocessableEntityError("Checkout total exceeds the supported currency range.");
    }

    const now = new Date().toISOString();
    const orderId = randomUUID();

    const orderRecord: OrderRecord = {
      id: orderId,
      quoteId: quote.id,
      customerId: dto.customerId,
      idempotencyKey: dto.idempotencyKey,
      status: "DRAFT",
      total: finalTotal,
      currency: recomputed.currency,
      createdAt: now,
      updatedAt: now,
      taxAmount: charges.taxAmount,
      shippingAmount: charges.shippingAmount,
      contact: dto.contact,
    };

    const initialHistory = {
      id: randomUUID(),
      orderId,
      fromStatus: null,
      toStatus: "DRAFT" as const,
      reason: "Initial draft order created from quote",
      createdAt: now,
    };

    return this.orderRepository.saveOrder(orderRecord, initialHistory);
  }

  async transitionStatus(dto: TransitionOrderDTO): Promise<OrderRecord> {
    const order = await this.orderRepository.findById(dto.orderId);
    if (!order) {
      throw new NotFoundError(
        `Order '${dto.orderId}' not found.`,
        ErrorCodes.ORDER_NOT_FOUND
      );
    }

    assertValidTransition(order.status, dto.toStatus);

    const historyItem = {
      id: randomUUID(),
      orderId: order.id,
      fromStatus: order.status,
      toStatus: dto.toStatus,
      reason: dto.reason,
      createdAt: new Date().toISOString(),
    };

    return this.orderRepository.updateStatus(order.id, dto.toStatus, historyItem);
  }

  async getOrderById(id: string): Promise<OrderRecord | null> {
    return this.orderRepository.findById(id);
  }

  async getStatusHistory(id: string) {
    return this.orderRepository.getStatusHistory(id);
  }
}
