import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { samplePricingConfig } from "../../src/config/samplePricingConfig";
import { ValidationError } from "../../src/core/errors/AppError";
import { InMemoryOrderRepository } from "../../src/modules/orders/order.repository";
import { OrderService } from "../../src/modules/orders/order.service";
import { OrderRecord } from "../../src/modules/orders/order.types";
import { InMemoryQuoteRepository } from "../../src/modules/quotes/quote.repository";
import {
  ProductionPaymentService,
  RazorpayPaymentGateway,
} from "../../src/modules/payments/payment.service";

const webhookSecret = "integration-webhook-secret";

function captureEvent(paymentOrderId: string, amount: number) {
  return Buffer.from(JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          order_id: paymentOrderId,
          id: "pay_capture_123",
          amount,
          currency: "INR",
        },
      },
    },
  }));
}

function sign(body: Buffer): string {
  return createHmac("sha256", webhookSecret).update(body).digest("hex");
}

describe("Razorpay payment webhook", () => {
  it("confirms only from the signed webhook after browser checkout returns", async () => {
    const orders = new InMemoryOrderRepository();
    const orderService = new OrderService(
      orders,
      new InMemoryQuoteRepository(),
      samplePricingConfig,
    );
    const order: OrderRecord = {
      id: randomUUID(),
      quoteId: randomUUID(),
      customerId: "customer-1",
      idempotencyKey: "checkout-1",
      status: "SUBMITTED",
      total: 12345,
      currency: "INR",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const paymentOrderId = "order_rzp_123";
    order.paymentOrderId = paymentOrderId;
    await orders.saveOrder(order, {
      id: randomUUID(),
      orderId: order.id,
      fromStatus: "DRAFT",
      toStatus: "SUBMITTED",
      createdAt: new Date().toISOString(),
    });
    const payments = new ProductionPaymentService(
      new RazorpayPaymentGateway("rzp_test", "key-secret", webhookSecret),
      orders,
      orderService,
    );
    const body = captureEvent(paymentOrderId, order.total);

    // Returning from the browser checkout does not itself prove payment.
    expect((await orders.findById(order.id))?.status).toBe("SUBMITTED");
    expect(await payments.processWebhook(body, sign(body), undefined)).toBe("processed");
    expect((await orders.findById(order.id))?.status).toBe("CONFIRMED");
    expect((await orders.getStatusHistory(order.id)).map(({ toStatus }) => toStatus)).toEqual([
      "SUBMITTED",
      "CONFIRMED",
    ]);

    expect(await payments.processWebhook(body, sign(body), undefined)).toBe("duplicate");
  });

  it("rejects an invalid webhook signature", async () => {
    const orders = new InMemoryOrderRepository();
    const payments = new ProductionPaymentService(
      new RazorpayPaymentGateway("rzp_test", "key-secret", webhookSecret),
      orders,
      new OrderService(orders, new InMemoryQuoteRepository(), samplePricingConfig),
    );
    const body = captureEvent("order_rzp_123", 12345);

    await expect(payments.processWebhook(body, "invalid-signature", "evt_invalid"))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("creates one full-amount payment link with a 24-hour expiry", async () => {
    const orders = new InMemoryOrderRepository();
    const orderService = new OrderService(
      orders,
      new InMemoryQuoteRepository(),
      samplePricingConfig,
    );
    const order: OrderRecord = {
      id: randomUUID(),
      quoteId: randomUUID(),
      customerId: "customer-1",
      idempotencyKey: "staff-order-1",
      status: "DRAFT",
      total: 23456,
      currency: "INR",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await orders.saveOrder(order, {
      id: randomUUID(),
      orderId: order.id,
      fromStatus: null,
      toStatus: "DRAFT",
      createdAt: order.createdAt,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "plink_123",
        short_url: "https://rzp.io/i/plink_123",
        amount: order.total,
        currency: order.currency,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const payments = new ProductionPaymentService(
      new RazorpayPaymentGateway("rzp_test", "key-secret", webhookSecret),
      orders,
      orderService,
    );

    try {
      const customer = {
        id: order.customerId,
        displayName: "Existing Customer",
        email: "customer@example.test",
        phone: "+919876543210",
      };
      const result = await payments.createPaymentLink(order.id, customer);
      const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;

      expect(request.amount).toBe(order.total);
      expect(request.accept_partial).toBe(false);
      expect(request.notify).toEqual({ email: false, sms: false });
      expect(request.expire_by).toBeGreaterThan(Math.floor(Date.now() / 1000) + 86_000);
      expect(request.expire_by).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 86_401);
      expect(result.paymentLinkId).toBe("plink_123");
      expect((await orders.findById(order.id))?.status).toBe("SUBMITTED");

      const replay = await payments.createPaymentLink(order.id, customer);
      expect(replay.paymentLinkId).toBe("plink_123");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("confirms a staff order only after Razorpay reports a fully paid payment link", async () => {
    const orders = new InMemoryOrderRepository();
    const orderService = new OrderService(
      orders,
      new InMemoryQuoteRepository(),
      samplePricingConfig,
    );
    const order: OrderRecord = {
      id: randomUUID(),
      quoteId: randomUUID(),
      customerId: "customer-1",
      idempotencyKey: "staff-order-2",
      status: "SUBMITTED",
      total: 12345,
      currency: "INR",
      paymentLinkId: "plink_paid_123",
      paymentLinkUrl: "https://rzp.io/i/plink_paid_123",
      paymentLinkState: "CREATED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await orders.saveOrder(order, {
      id: randomUUID(),
      orderId: order.id,
      fromStatus: "DRAFT",
      toStatus: "SUBMITTED",
      createdAt: order.createdAt,
    });
    const payments = new ProductionPaymentService(
      new RazorpayPaymentGateway("rzp_test", "key-secret", webhookSecret),
      orders,
      orderService,
    );
    const body = Buffer.from(JSON.stringify({
      event: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            id: "plink_paid_123",
            amount_paid: order.total,
            currency: order.currency,
          },
        },
        payment: { entity: { id: "pay_link_capture_123" } },
      },
    }));

    expect(await payments.processWebhook(body, sign(body), "evt_link_paid_123")).toBe("processed");
    expect((await orders.findById(order.id))?.status).toBe("CONFIRMED");
  });

  it("cancels an unpaid staff order when its 24-hour payment link expires", async () => {
    const orders = new InMemoryOrderRepository();
    const orderService = new OrderService(
      orders,
      new InMemoryQuoteRepository(),
      samplePricingConfig,
    );
    const order: OrderRecord = {
      id: randomUUID(),
      quoteId: randomUUID(),
      customerId: "customer-1",
      idempotencyKey: "staff-order-3",
      status: "SUBMITTED",
      total: 12345,
      currency: "INR",
      paymentLinkId: "plink_expired_123",
      paymentLinkUrl: "https://rzp.io/i/plink_expired_123",
      paymentLinkState: "CREATED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await orders.saveOrder(order, {
      id: randomUUID(),
      orderId: order.id,
      fromStatus: "DRAFT",
      toStatus: "SUBMITTED",
      createdAt: order.createdAt,
    });
    const payments = new ProductionPaymentService(
      new RazorpayPaymentGateway("rzp_test", "key-secret", webhookSecret),
      orders,
      orderService,
    );
    const body = Buffer.from(JSON.stringify({
      event: "payment_link.expired",
      payload: {
        payment_link: { entity: { id: "plink_expired_123" } },
      },
    }));

    expect(await payments.processWebhook(body, sign(body), "evt_link_expired_123")).toBe("processed");
    const updatedOrder = await orders.findById(order.id);
    expect(updatedOrder?.status).toBe("CANCELLED");
    expect(updatedOrder?.paymentLinkState).toBe("EXPIRED");
  });
});
