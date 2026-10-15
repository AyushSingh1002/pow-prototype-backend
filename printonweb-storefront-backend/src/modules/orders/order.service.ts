import { v4 as uuidv4 } from "uuid";
import { IOrderRepository } from "./order.repository";
import { CreateOrderDTO, OrderRecord, TransitionOrderDTO } from "./order.types";
import { IQuoteRepository } from "../quotes/quote.repository";
import { PricingConfig } from "../pricing/pricing.types";
import { estimate } from "../pricing/pricing.engine";
import { assertValidTransition } from "./order.state-machine";
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
    private readonly pricingConfig: PricingConfig
  ) {}

  async createDraftOrder(dto: CreateOrderDTO): Promise<OrderRecord> {
    // 1. Idempotency Check
    const existing = await this.orderRepository.findByCustomerIdAndIdempotencyKey(
      dto.customerId,
      dto.idempotencyKey
    );

    if (existing) {
      if (existing.quoteId === dto.quoteId) {
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

    // Check expiry
    if (new Date(quote.expiresAt) <= new Date()) {
      throw new GoneError(
        `Quote '${dto.quoteId}' has expired and cannot be converted to an order.`,
        ErrorCodes.QUOTE_EXPIRED
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

    const now = new Date().toISOString();
    const orderId = uuidv4();

    const orderRecord: OrderRecord = {
      id: orderId,
      quoteId: quote.id,
      customerId: dto.customerId,
      idempotencyKey: dto.idempotencyKey,
      status: "DRAFT",
      total: recomputed.total,
      currency: recomputed.currency,
      createdAt: now,
      updatedAt: now,
    };

    const initialHistory = {
      id: uuidv4(),
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
      id: uuidv4(),
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
