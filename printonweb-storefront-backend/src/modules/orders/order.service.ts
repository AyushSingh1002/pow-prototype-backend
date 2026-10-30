import { randomUUID } from "node:crypto";
import { IOrderRepository } from "./order.repository";
import {
  CreateOrderDTO,
  OrderRecord,
  StaffOrderDetails,
  StaffQueueOrder,
  TransitionOrderDTO,
} from "./order.types";
import { IQuoteRepository } from "../quotes/quote.repository";
import { ICatalogueRepository } from "../catalogue/catalogue.repository";
import { PricingConfig } from "../pricing/pricing.types";
import { estimate } from "../pricing/pricing.engine";
import { assertValidTransition } from "./order.state-machine";
import { ICheckoutPricingService } from "./checkout-pricing.service";
import { ServiceUnavailableError } from "../../core/errors/AppError";
import {
  NotFoundError,
  GoneError,
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";

export class OrderService {
  constructor(
    private readonly orderRepository: IOrderRepository,
    private readonly quoteRepository: IQuoteRepository,
    private readonly pricingConfig: PricingConfig,
    private readonly checkoutPricing?: ICheckoutPricingService,
    private readonly catalogueRepository?: ICatalogueRepository
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
          existing.deliveryMethod === (dto.deliveryMethod ?? "SHIP") &&
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

    if (!this.checkoutPricing && !this.pricingConfig.isSample) {
      throw new ServiceUnavailableError("Production checkout pricing is not configured.");
    }
    const deliveryMethod = dto.deliveryMethod ?? "SHIP";
    const charges = this.checkoutPricing
      ? await this.checkoutPricing.calculate(quote, dto.contact, deliveryMethod)
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
      deliveryMethod,
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

  async transitionStatus(
    dto: TransitionOrderDTO,
    options: {
      actingStaffId?: string;
      isAdmin?: boolean;
      reassignToStaffId?: string;
    } = {}
  ): Promise<OrderRecord> {
    if (options.reassignToStaffId) {
      if (!options.actingStaffId || !options.isAdmin) {
        throw new ForbiddenError("Only an admin can reassign a production order.");
      }
      return this.orderRepository.reassignOrder(
        dto.orderId,
        options.actingStaffId,
        options.reassignToStaffId,
        {
          id: randomUUID(),
          orderId: dto.orderId,
          fromStatus: null,
          toStatus: dto.toStatus,
          reason: dto.reason,
          createdAt: new Date().toISOString(),
        }
      );
    }
    if (options.actingStaffId && dto.toStatus === "IN_PRODUCTION") {
      assertValidTransition("CONFIRMED", dto.toStatus);
      return this.orderRepository.claimOrder(dto.orderId, options.actingStaffId, {
        id: randomUUID(),
        orderId: dto.orderId,
        fromStatus: "CONFIRMED",
        toStatus: dto.toStatus,
        reason: dto.reason ?? "Claimed by staff",
        createdAt: new Date().toISOString(),
      });
    }
    const order = await this.orderRepository.findById(dto.orderId);
    if (!order) {
      throw new NotFoundError(
        `Order '${dto.orderId}' not found.`,
        ErrorCodes.ORDER_NOT_FOUND
      );
    }

    try {
      assertValidTransition(order.status, dto.toStatus);
    } catch (error) {
      if (options.actingStaffId && error instanceof UnprocessableEntityError) {
        throw new ConflictError(
          `Order is now '${order.status}' and cannot transition to '${dto.toStatus}'.`,
          ErrorCodes.INVALID_STATE_TRANSITION
        );
      }
      throw error;
    }

    const historyItem = {
      id: randomUUID(),
      orderId: order.id,
      fromStatus: order.status,
      toStatus: dto.toStatus,
      reason: dto.reason,
      createdAt: new Date().toISOString(),
    };

    return this.orderRepository.updateStatus(
      order.id,
      dto.toStatus,
      historyItem,
      options.actingStaffId
        ? { staffId: options.actingStaffId, isAdmin: options.isAdmin ?? false }
        : undefined
    );
  }

  async listStaffOrders(staffId: string): Promise<StaffQueueOrder[]> {
    const orders = await this.orderRepository.listStaffOrders(staffId);
    if (!this.pricingConfig.isSample) return orders;
    return Promise.all(orders.map((order) => this.attachDemoQuoteDetails(order)));
  }

  async getStaffOrderDetails(orderId: string, staffId: string): Promise<StaffOrderDetails | null> {
    const [details, order] = await Promise.all([
      this.orderRepository.getStaffOrderDetails(orderId, staffId),
      this.orderRepository.findById(orderId),
    ]);
    if (!details || !order) return null;

    const quote = await this.quoteRepository.findById(order.quoteId);
    if (!quote) {
      throw new NotFoundError(`Quote '${order.quoteId}' not found.`, ErrorCodes.QUOTE_NOT_FOUND);
    }

    const productDetails = this.pricingConfig.isSample
      ? await this.attachDemoQuoteDetails(details)
      : details;
    return {
      ...productDetails,
      lineItems: quote.lineItems,
      total: order.total,
    };
  }

  async findStaffAccount(userId: string) {
    return this.orderRepository.findStaffAccount(userId);
  }

  async searchStaffCustomers(query: string) {
    return this.orderRepository.searchCustomers(query);
  }

  async getStaffCustomer(customerId: string) {
    return this.orderRepository.findCustomerById(customerId);
  }

  async listStaffAccounts(adminId: string) {
    return this.orderRepository.listStaffAccounts(adminId);
  }

  async claimOrder(orderId: string, staffId: string): Promise<OrderRecord> {
    return this.transitionStatus(
      { orderId, toStatus: "IN_PRODUCTION", reason: "Claimed by staff" },
      { actingStaffId: staffId }
    );
  }

  async releaseOrder(orderId: string, staffId: string, isAdmin: boolean): Promise<OrderRecord> {
    return this.orderRepository.releaseOrder(orderId, staffId, isAdmin);
  }

  async flagProblem(
    orderId: string,
    staffId: string,
    note: string,
    customerVisible: boolean
  ): Promise<void> {
    return this.orderRepository.addStaffNote(orderId, staffId, note, customerVisible);
  }

  async listDeadNotifications(staffId: string) {
    return this.orderRepository.listDeadNotifications(staffId);
  }

  async retryNotification(id: string, staffId: string): Promise<boolean> {
    return this.orderRepository.retryNotification(id, staffId);
  }

  private async attachDemoQuoteDetails<T extends StaffQueueOrder>(order: T): Promise<T> {
    const quote = await this.quoteRepository.findById(order.productId);
    if (!quote) return order;
    const product = await this.catalogueRepository?.findProductById(quote.productId);
    return {
      ...order,
      productId: quote.productId,
      productName: product?.name ?? quote.productId,
      quantity: quote.quantity,
      validatedOptions: quote.validatedOptions,
    };
  }

  async getOrderById(id: string): Promise<OrderRecord | null> {
    return this.orderRepository.findById(id);
  }

  async getOrderQuote(orderId: string) {
    const order = await this.orderRepository.findById(orderId);
    return order ? this.quoteRepository.findById(order.quoteId) : null;
  }

  async getStatusHistory(id: string) {
    return this.orderRepository.getStatusHistory(id);
  }
}
