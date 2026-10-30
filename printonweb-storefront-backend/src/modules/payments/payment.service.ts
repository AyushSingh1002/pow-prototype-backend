import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import {
  ConflictError,
  ServiceUnavailableError,
  UnprocessableEntityError,
  ValidationError,
} from "../../core/errors/AppError";
import { IOrderRepository } from "../orders/order.repository";
import { OrderService } from "../orders/order.service";
import { OrderRecord } from "../orders/order.types";
import { StaffCustomer } from "../orders/order.types";

const PAYMENT_LINK_TTL_MS = 24 * 60 * 60 * 1000;

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
  type: "payment.captured" | "payment.failed" | "payment_link.paid" | "payment_link.expired";
  paymentOrderId: string;
  paymentLinkId?: string;
  paymentId: string;
  amount: number;
  currency: string;
}

export interface PaymentGateway {
  createOrder(order: OrderRecord): Promise<PaymentOrderResult>;
  createPaymentLink(
    order: OrderRecord,
    customer: StaffCustomer,
    expiresAt: number
  ): Promise<{ paymentLinkId: string; shortUrl: string }>;
  verifyWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined): VerifiedPaymentEvent;
  verifyCheckoutPayment(input: {
    orderId: string;
    paymentId: string;
    checkoutSignature: string;
    amount: number;
    currency: string;
  }): Promise<void>;
}

export class RazorpayPaymentGateway implements PaymentGateway {
  constructor(
    private readonly keyId = env.RAZORPAY_KEY_ID,
    private readonly secret = env.RAZORPAY_KEY_SECRET,
    private readonly webhookSecret = env.RAZORPAY_WEBHOOK_SECRET,
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

  async verifyCheckoutPayment(input: {
    orderId: string;
    paymentId: string;
    checkoutSignature: string;
    amount: number;
    currency: string;
  }): Promise<void> {
    if (!this.keyId || !this.secret) {
      throw new ServiceUnavailableError("Razorpay credentials are not configured.");
    }
    const signedData = `${input.orderId}|${input.paymentId}`;
    const expected = createHmac("sha256", this.secret).update(signedData).digest("hex");
    if (!/^[a-f0-9]{64}$/i.test(input.checkoutSignature)) {
      throw new ValidationError("Razorpay checkout signature is invalid.");
    }
    const supplied = Buffer.from(input.checkoutSignature, "hex");
    const calculated = Buffer.from(expected, "hex");
    if (!timingSafeEqual(calculated, supplied)) {
      throw new ValidationError("Razorpay checkout signature is invalid.");
    }

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(`${this.apiBase}/payments/${encodeURIComponent(input.paymentId)}`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.secret}`).toString("base64")}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableError("Razorpay is unavailable.");
    }
    if (!response.ok) {
      throw new ServiceUnavailableError("Razorpay payment outcome could not be verified.");
    }
    const payment: unknown = await response.json();
    if (
      !isRecord(payment) ||
      payment.id !== input.paymentId ||
      payment.order_id !== input.orderId ||
      payment.status !== "captured" ||
      payment.amount !== input.amount ||
      payment.currency !== input.currency ||
      !Number.isSafeInteger(payment.amount) ||
      typeof payment.currency !== "string"
    ) {
      throw new ValidationError("Razorpay payment details do not match the checkout order.");
    }
  }

  async createPaymentLink(
    order: OrderRecord,
    customer: StaffCustomer,
    expiresAt: number
  ): Promise<{ paymentLinkId: string; shortUrl: string }> {
    if (!this.keyId || !this.secret) {
      throw new ServiceUnavailableError("Razorpay credentials are not configured.");
    }
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(`${this.apiBase}/payment_links`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.secret}`).toString("base64")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          amount: order.total,
          currency: order.currency,
          accept_partial: false,
          reference_id: order.id,
          description: `Press & Proof order ${order.id}`,
          customer: {
            name: customer.displayName,
            email: customer.email,
            ...(customer.phone ? { contact: customer.phone } : {}),
          },
          notify: { email: false, sms: false },
          reminder_enable: false,
          expire_by: expiresAt,
          notes: { internal_order_id: order.id },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableError("Razorpay payment link outcome could not be verified.");
    }

    if (!response.ok) {
      throw new ServiceUnavailableError("Razorpay could not create a payment link.");
    }
    const result: unknown = await response.json();
    if (
      !isRecord(result) ||
      typeof result.id !== "string" ||
      result.amount !== order.total ||
      result.currency !== order.currency ||
      typeof result.short_url !== "string"
    ) {
      throw new ServiceUnavailableError("Razorpay returned an invalid payment link.");
    }
    let shortUrl: URL;
    try {
      shortUrl = new URL(result.short_url);
    } catch {
      throw new ServiceUnavailableError("Razorpay returned an invalid payment link URL.");
    }
    if (shortUrl.protocol !== "https:" || !["rzp.io", "razorpay.com"].includes(shortUrl.hostname)) {
      throw new ServiceUnavailableError("Razorpay returned an untrusted payment link URL.");
    }
    return { paymentLinkId: result.id, shortUrl: shortUrl.toString() };
  }

  verifyWebhook(
    rawBody: Buffer,
    signature: string | undefined,
    eventId: string | undefined
  ): VerifiedPaymentEvent {
    if (!signature || !this.webhookSecret) {
      throw new ValidationError("Razorpay webhook signature is missing.");
    }
    const expected = createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest("hex");
    if (!/^[a-f0-9]{64}$/i.test(signature)) {
      throw new ValidationError("Razorpay webhook signature is invalid.");
    }
    const actual = Buffer.from(signature, "hex");
    if (!timingSafeEqual(Buffer.from(expected, "hex"), actual)) {
      throw new ValidationError("Razorpay webhook signature is invalid.");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new ValidationError("Razorpay webhook payload is malformed.");
    }
    const resolvedEventId = typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).event_id === "string"
      ? (payload as Record<string, string>).event_id
      : eventId || `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
    if (!resolvedEventId.trim()) {
      throw new ValidationError("Razorpay webhook event ID could not be resolved.");
    }
    if (
      !isRecord(payload) ||
      (payload.event !== "payment.captured" &&
        payload.event !== "payment.failed" &&
        payload.event !== "payment_link.paid" &&
        payload.event !== "payment_link.expired")
    ) {
      throw new ValidationError("Razorpay webhook event type is not supported.");
    }
    const payment = isRecord(payload.payload) && isRecord(payload.payload.payment)
      ? payload.payload.payment.entity
      : undefined;
    if (payload.event === "payment_link.expired") {
      const paymentLink = isRecord(payload.payload) && isRecord(payload.payload.payment_link)
        ? payload.payload.payment_link.entity
        : undefined;
      if (!isRecord(paymentLink) || typeof paymentLink.id !== "string") {
        throw new ValidationError("Razorpay expired payment link webhook data is invalid.");
      }
      return {
        eventId: resolvedEventId,
        type: payload.event,
        paymentOrderId: "",
        paymentLinkId: paymentLink.id,
        paymentId: "",
        amount: 0,
        currency: "",
      };
    }
    if (payload.event === "payment_link.paid") {
      const paymentLink = isRecord(payload.payload) && isRecord(payload.payload.payment_link)
        ? payload.payload.payment_link.entity
        : undefined;
      if (
        !isRecord(paymentLink) ||
        typeof paymentLink.id !== "string" ||
        !Number.isSafeInteger(paymentLink.amount_paid) ||
        typeof paymentLink.currency !== "string" ||
        !isRecord(payment) ||
        typeof payment.id !== "string"
      ) {
        throw new ValidationError("Razorpay payment link webhook data is invalid.");
      }
      return {
        eventId: resolvedEventId,
        type: payload.event,
        paymentOrderId: "",
        paymentLinkId: paymentLink.id,
        paymentId: payment.id,
        amount: paymentLink.amount_paid as number,
        currency: paymentLink.currency,
      };
    }
    if (
      !isRecord(payment) ||
      typeof payment.order_id !== "string" ||
      typeof payment.id !== "string" ||
      !Number.isSafeInteger(payment.amount) ||
      typeof payment.currency !== "string"
    ) {
      throw new ValidationError("Razorpay webhook payment data is invalid.");
    }
    return {
      eventId: resolvedEventId,
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
  private readonly paymentLinkRequests = new Map<string, Promise<{
    paymentLinkId: string;
    shortUrl: string;
    expiresAt: string;
  }>>();

  constructor(
    private readonly gateway: PaymentGateway,
    private readonly orders: IOrderRepository,
    private readonly orderService: OrderService
  ) {}

  async verifyCheckoutPayment(
    orderId: string,
    paymentOrderId: string,
    paymentId: string,
    checkoutSignature: string
  ): Promise<void> {
    const order = await this.orders.findByPaymentOrderId(paymentOrderId);
    if (!order || order.id !== orderId) {
      throw new UnprocessableEntityError("Payment order is not associated with this local order.");
    }
    await this.gateway.verifyCheckoutPayment({
      orderId: paymentOrderId,
      paymentId,
      checkoutSignature,
      amount: order.total,
      currency: order.currency,
    });
    await this.orders.setPaymentId(paymentOrderId, paymentId);
    if (order.status === "SUBMITTED") {
      await this.orderService.transitionStatus({
        orderId: order.id,
        toStatus: "CONFIRMED",
        reason: `Razorpay checkout signature verified (${paymentId})`,
      });
    } else if (order.status !== "CONFIRMED") {
      throw new UnprocessableEntityError(
        `Captured payment cannot confirm order in '${order.status}' state.`
      );
    }
  }

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
        keyId: env.RAZORPAY_KEY_ID ?? "",
        amount: order.total,
        currency: order.currency,
        orderId: order.id,
      };
    }
    const result = await this.gateway.createOrder(order);
    await this.orders.setPaymentOrderId(order.id, result.paymentOrderId);
    return result;
  }

  async createPaymentLink(
    orderId: string,
    customer: StaffCustomer
  ): Promise<{ paymentLinkId: string; shortUrl: string; expiresAt: string }> {
    const current = this.paymentLinkRequests.get(orderId);
    if (current) return current;
    const request = this.createPaymentLinkOnce(orderId, customer);
    this.paymentLinkRequests.set(orderId, request);
    try {
      return await request;
    } finally {
      if (this.paymentLinkRequests.get(orderId) === request) {
        this.paymentLinkRequests.delete(orderId);
      }
    }
  }

  private async createPaymentLinkOnce(
    orderId: string,
    customer: StaffCustomer
  ): Promise<{ paymentLinkId: string; shortUrl: string; expiresAt: string }> {
    let order = await this.orderService.getOrderById(orderId);
    if (!order) throw new UnprocessableEntityError("Order does not exist.");
    if (order.customerId !== customer.id) {
      throw new UnprocessableEntityError("Payment link customer does not match the order owner.");
    }
    if (order.status !== "DRAFT" && order.status !== "SUBMITTED") {
      throw new UnprocessableEntityError(
        `Cannot create a payment link for order in '${order.status}' state.`
      );
    }
    if (order.paymentLinkState === "CREATED" && order.paymentLinkId && order.paymentLinkUrl && order.paymentLinkExpiresAt) {
      await this.orders.enqueuePaymentLinkEmail(
        order.id,
        customer.id,
        order.paymentLinkUrl,
        order.paymentLinkExpiresAt
      );
      return {
        paymentLinkId: order.paymentLinkId,
        shortUrl: order.paymentLinkUrl,
        expiresAt: order.paymentLinkExpiresAt,
      };
    }
    if (order.paymentLinkState) {
      throw new UnprocessableEntityError(
        "Payment link creation is unresolved. Reconcile the order in Razorpay before retrying."
      );
    }
    if (order.status === "DRAFT") {
      order = await this.orderService.transitionStatus({
        orderId,
        toStatus: "SUBMITTED",
        reason: "Submitted by staff for payment",
      });
    }
    if (order.status !== "SUBMITTED") {
      throw new UnprocessableEntityError(
        `Cannot create a payment link for order in '${order.status}' state.`
      );
    }
    if (!(await this.orders.claimPaymentLinkCreation(order.id))) {
      const currentOrder = await this.orderService.getOrderById(order.id);
      if (currentOrder?.paymentLinkState === "CREATED" && currentOrder.paymentLinkId && currentOrder.paymentLinkUrl && currentOrder.paymentLinkExpiresAt) {
        await this.orders.enqueuePaymentLinkEmail(
          currentOrder.id,
          customer.id,
          currentOrder.paymentLinkUrl,
          currentOrder.paymentLinkExpiresAt
        );
        return {
          paymentLinkId: currentOrder.paymentLinkId,
          shortUrl: currentOrder.paymentLinkUrl,
          expiresAt: currentOrder.paymentLinkExpiresAt,
        };
      }
      throw new UnprocessableEntityError(
        "Payment link creation is already in progress or requires reconciliation."
      );
    }

    const expiresAt = new Date(Date.now() + PAYMENT_LINK_TTL_MS).toISOString();
    let paymentLink: { paymentLinkId: string; shortUrl: string };
    try {
      paymentLink = await this.gateway.createPaymentLink(
        order,
        customer,
        Math.floor(Date.parse(expiresAt) / 1000)
      );
    } catch {
      await this.orders.markPaymentLinkCreationUnknown(order.id);
      throw new ServiceUnavailableError(
        "Payment link creation outcome is unknown. Do not retry; reconcile in the Razorpay dashboard."
      );
    }
    await this.orders.completePaymentLinkCreation(
      order.id,
      paymentLink.paymentLinkId,
      paymentLink.shortUrl,
      expiresAt
    );
    await this.orders.enqueuePaymentLinkEmail(
      order.id,
      customer.id,
      paymentLink.shortUrl,
      expiresAt
    );
    return { ...paymentLink, expiresAt };
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
      if (
        (event.type === "payment_link.paid" || event.type === "payment_link.expired") &&
        !event.paymentLinkId
      ) {
        throw new ValidationError("Razorpay payment link webhook is missing its link ID.");
      }
      const order = event.paymentLinkId
        ? await this.orders.findByPaymentLinkId(event.paymentLinkId)
        : await this.orders.findByPaymentOrderId(event.paymentOrderId);
      if (!order) throw new UnprocessableEntityError("Payment order is not associated with a local order.");
      if (
        event.type !== "payment_link.expired" &&
        (event.amount !== order.total || event.currency !== order.currency)
      ) {
        throw new UnprocessableEntityError("Payment amount or currency does not match the server order.");
      }
      if (event.type === "payment_link.expired") {
        const paymentLinkId = event.paymentLinkId;
        if (!paymentLinkId) {
          throw new ValidationError("Razorpay expired payment link webhook is missing its link ID.");
        }
        if (order.status === "SUBMITTED") {
          try {
            await this.orderService.transitionStatus({
              orderId: order.id,
              toStatus: "CANCELLED",
              reason: "Razorpay payment link expired after 24 hours",
            });
          } catch (error) {
            const current = await this.orderService.getOrderById(order.id);
            if (!(error instanceof ConflictError) || current?.status !== "CONFIRMED") {
              throw error;
            }
          }
        }
        const currentOrder = await this.orderService.getOrderById(order.id);
        if (currentOrder?.status === "CANCELLED") {
          await this.orders.markPaymentLinkExpired(paymentLinkId);
        }
      } else if (
        (event.type === "payment.captured" || event.type === "payment_link.paid") &&
        order.status === "SUBMITTED"
      ) {
        await this.orders.setPaymentId(event.paymentLinkId ?? event.paymentOrderId, event.paymentId);
        await this.orderService.transitionStatus({
          orderId: order.id,
          toStatus: "CONFIRMED",
          reason: `Razorpay payment captured (${event.paymentId})`,
        });
      } else if (
        (event.type === "payment.captured" || event.type === "payment_link.paid") &&
        order.status !== "CONFIRMED"
      ) {
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
