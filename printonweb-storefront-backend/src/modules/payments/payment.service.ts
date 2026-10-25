import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import { ServiceUnavailableError, UnprocessableEntityError } from "../../core/errors/AppError";
import { IOrderRepository } from "../orders/order.repository";
import { OrderService } from "../orders/order.service";
import { OrderRecord } from "../orders/order.types";

export interface DemoCheckoutInput {
  orderId: string;
  paymentMethod: "demo_card" | "demo_upi" | "demo_netbanking";
}

export interface DemoCheckoutResult {
  transactionId: string;
  orderId: string;
  status: "DEMO_SUCCESS";
  amountCharged: 0; // Explicitly zero
  isDemo: true;
  message: "DEMO ONLY: No real payment was initiated, processed, or captured.";
  timestamp: string;
}

export class DemoPaymentService {
  async processDemoCheckout(input: DemoCheckoutInput): Promise<DemoCheckoutResult> {
    return {
      transactionId: `demo_tx_${Date.now()}`,
      orderId: input.orderId,
      status: "DEMO_SUCCESS",
      amountCharged: 0,
      isDemo: true,
      message: "DEMO ONLY: No real payment was initiated, processed, or captured.",
      timestamp: new Date().toISOString(),
    };
  }
}

export interface PaymentOrderResult {
  paymentOrderId: string;
  keyId: string;
  amount: number;
  currency: string;
  orderId: string;
}

export interface VerifiedPaymentEvent {
  eventId: string;
  type: "payment.captured" | "payment.failed";
  paymentOrderId: string;
  paymentId: string;
  amount: number;
  currency: string;
}

export interface PaymentGateway {
  createOrder(order: OrderRecord): Promise<PaymentOrderResult>;
  verifyWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined): VerifiedPaymentEvent;
}

export class RazorpayPaymentGateway implements PaymentGateway {
  constructor(
    private readonly keyId = env.PAYMENT_KEY_ID,
    private readonly secret = env.PAYMENT_SECRET_KEY,
    private readonly webhookSecret = env.PAYMENT_WEBHOOK_SECRET,
    private readonly apiBase = "https://api.razorpay.com/v1"
  ) {}

  async createOrder(order: OrderRecord): Promise<PaymentOrderResult> {
    if (!this.keyId || !this.secret) {
      throw new ServiceUnavailableError("Razorpay credentials are not configured.");
    }
    const body = {
      amount: order.total,
      currency: order.currency,
      receipt: order.id,
      notes: { internal_order_id: order.id },
    };

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(`${this.apiBase}/orders`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.secret}`).toString("base64")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableError("Razorpay is unavailable.");
    }

    if (!response.ok) {
      throw new ServiceUnavailableError("Razorpay could not create a payment order.");
    }
    const result: unknown = await response.json();
    if (
      !isRecord(result) ||
      typeof result.id !== "string" ||
      result.amount !== order.total ||
      result.currency !== order.currency
    ) {
      throw new ServiceUnavailableError("Razorpay returned an invalid payment order.");
    }

    return {
      paymentOrderId: result.id,
      keyId: this.keyId,
      amount: order.total,
      currency: order.currency,
      orderId: order.id,
    };
  }

  verifyWebhook(
    rawBody: Buffer,
    signature: string | undefined,
    eventId: string | undefined
  ): VerifiedPaymentEvent {
    if (!signature || !eventId || !this.webhookSecret) {
      throw new UnprocessableEntityError("Razorpay webhook signature or event ID is missing.");
    }
    const expected = createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "hex");
    } catch {
      throw new UnprocessableEntityError("Razorpay webhook signature is invalid.");
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnprocessableEntityError("Razorpay webhook signature is invalid.");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new UnprocessableEntityError("Razorpay webhook payload is malformed.");
    }
    if (!isRecord(payload) || payload.event !== "payment.captured" && payload.event !== "payment.failed") {
      throw new UnprocessableEntityError("Razorpay webhook event type is not supported.");
    }
    const payment = isRecord(payload.payload) && isRecord(payload.payload.payment)
      ? payload.payload.payment.entity
      : undefined;
    if (
      !isRecord(payment) ||
      typeof payment.order_id !== "string" ||
      typeof payment.id !== "string" ||
      !Number.isSafeInteger(payment.amount) ||
      typeof payment.currency !== "string"
    ) {
      throw new UnprocessableEntityError("Razorpay webhook payment data is invalid.");
    }
    return {
      eventId,
      type: payload.event,
      paymentOrderId: payment.order_id,
      paymentId: payment.id,
      amount: payment.amount as number,
      currency: payment.currency,
    };
  }
}

export class ProductionPaymentService {
  private readonly paymentOrderRequests = new Map<string, Promise<PaymentOrderResult>>();

  constructor(
    private readonly gateway: PaymentGateway,
    private readonly orders: IOrderRepository,
    private readonly orderService: OrderService
  ) {}

  async createPaymentOrder(orderId: string): Promise<PaymentOrderResult> {
    const current = this.paymentOrderRequests.get(orderId);
    if (current) return current;
    const request = this.createPaymentOrderOnce(orderId);
    this.paymentOrderRequests.set(orderId, request);
    try {
      return await request;
    } finally {
      if (this.paymentOrderRequests.get(orderId) === request) {
        this.paymentOrderRequests.delete(orderId);
      }
    }
  }

  private async createPaymentOrderOnce(orderId: string): Promise<PaymentOrderResult> {
    let order = await this.orderService.getOrderById(orderId);
    if (!order) throw new UnprocessableEntityError("Order does not exist.");
    if (order.status === "DRAFT") {
      order = await this.orderService.transitionStatus({
        orderId,
        toStatus: "SUBMITTED",
        reason: "Submitted for payment",
      });
    }
    if (order.status !== "SUBMITTED") {
      throw new UnprocessableEntityError(
        `Cannot create payment for order in '${order.status}' state.`
      );
    }
    if (order.paymentOrderId) {
      return {
        paymentOrderId: order.paymentOrderId,
        keyId: env.PAYMENT_KEY_ID ?? "",
        amount: order.total,
        currency: order.currency,
        orderId: order.id,
      };
    }
    const result = await this.gateway.createOrder(order);
    await this.orders.setPaymentOrderId(order.id, result.paymentOrderId);
    return result;
  }

  async processWebhook(
    rawBody: Buffer,
    signature: string | undefined,
    eventId: string | undefined
  ): Promise<"processed" | "duplicate"> {
    const event = this.gateway.verifyWebhook(rawBody, signature, eventId);
    const claimed = await this.orders.claimPaymentEvent(
      event.eventId,
      event.type,
      JSON.parse(rawBody.toString("utf8"))
    );
    if (!claimed) return "duplicate";

    try {
      const order = await this.orders.findByPaymentOrderId(event.paymentOrderId);
      if (!order) throw new UnprocessableEntityError("Payment order is not associated with a local order.");
      if (event.amount !== order.total || event.currency !== order.currency) {
        throw new UnprocessableEntityError("Payment amount or currency does not match the server order.");
      }
      if (event.type === "payment.captured" && order.status === "SUBMITTED") {
        await this.orders.setPaymentId(event.paymentOrderId, event.paymentId);
        await this.orderService.transitionStatus({
          orderId: order.id,
          toStatus: "CONFIRMED",
          reason: `Razorpay payment captured (${event.paymentId})`,
        });
      } else if (event.type === "payment.captured" && order.status !== "CONFIRMED") {
        throw new UnprocessableEntityError(
          `Captured payment cannot confirm order in '${order.status}' state.`
        );
      }
      await this.orders.finishPaymentEvent(event.eventId, true);
      return "processed";
    } catch (error) {
      await this.orders.finishPaymentEvent(event.eventId, false);
      throw error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
