import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app";
import { InMemoryOrderRepository } from "../../src/modules/orders/order.repository";
import { InMemoryQuoteRepository } from "../../src/modules/quotes/quote.repository";
import { QuoteRecord } from "../../src/modules/quotes/quote.types";
import { samplePricingConfig } from "../../src/config/samplePricingConfig";
import { OrderRecord, OrderStatus, OrderStatusHistoryItem } from "../../src/modules/orders/order.types";

const staffToken = "demo-staff-token";

describe("staff fulfillment API", () => {
  it("serves the demo staff queue and complete quote-backed job ticket", async () => {
    const orderRepository = new InMemoryOrderRepository();
    const order = await createConfirmedOrder(orderRepository);
    const quoteRepository = new InMemoryQuoteRepository();
    const quote: QuoteRecord = {
      id: order.quoteId,
      productId: "demo_book",
      validatedOptions: { size: "A4", binding: "perfect" },
      quantity: 25,
      lineItems: [{
        code: "BASE_PRICE",
        description: "Base printing",
        unitAmount: 400,
        quantity: 25,
        lineTotal: 10000,
      }],
      total: 10000,
      currency: "INR",
      pricingConfigVersion: samplePricingConfig.version,
      isSample: true,
      taxIncluded: false,
      shippingIncluded: false,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      customerId: order.customerId,
    };
    await quoteRepository.save(quote);
    const app = createApp({
      orderRepository,
      quoteRepository,
      pricingConfig: samplePricingConfig,
    });
    const headers = { Authorization: `Bearer ${staffToken}` };

    const queue = await request(app).get("/api/staff/orders").set(headers);
    expect(queue.status).toBe(200);
    expect(queue.body.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: order.id, status: "CONFIRMED", quantity: 25 }),
    ]));

    const ticket = await request(app).get(`/api/staff/orders/${order.id}`).set(headers);
    expect(ticket.status).toBe(200);
    expect(ticket.body.order).toMatchObject({
      id: order.id,
      validatedOptions: quote.validatedOptions,
      lineItems: quote.lineItems,
      total: order.total,
    });
  });

  it("rejects customer sessions from the staff queue", async () => {
    const app = createApp({ orderRepository: new InMemoryOrderRepository() });
    const response = await request(app)
      .get("/api/staff/orders")
      .set("Authorization", "Bearer demo-token");

    expect(response.status).toBe(401);
  });

  it("allows only one of two concurrent claim requests and names the winning holder", async () => {
    const repository = new InMemoryOrderRepository();
    const order = await createConfirmedOrder(repository);
    const app = createApp({ orderRepository: repository });

    const responses = await Promise.all([
      request(app).post(`/api/staff/orders/${order.id}/claim`).set("Authorization", `Bearer ${staffToken}`),
      request(app).post(`/api/staff/orders/${order.id}/claim`).set("Authorization", `Bearer ${staffToken}`),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict?.body.error.message).toContain("already claimed by Demo Staff");
    expect((await repository.findById(order.id))?.assignedStaffId).toBe("staff_demo_1");
    expect((await repository.findById(order.id))?.status).toBe("IN_PRODUCTION");
  });

  it("applies only one concurrent completion transition", async () => {
    const repository = new InMemoryOrderRepository();
    const order = await createConfirmedOrder(repository);
    const app = createApp({ orderRepository: repository });
    const headers = { Authorization: `Bearer ${staffToken}` };

    const claim = await request(app)
      .post(`/api/staff/orders/${order.id}/claim`)
      .set(headers);
    expect(claim.status).toBe(200);

    const responses = await Promise.all([
      request(app).post(`/api/staff/orders/${order.id}/complete`).set(headers),
      request(app).post(`/api/staff/orders/${order.id}/complete`).set(headers),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await repository.findById(order.id))?.status).toBe("COMPLETED");
  });
});

async function createConfirmedOrder(repository: InMemoryOrderRepository): Promise<OrderRecord> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const order: OrderRecord = {
    id,
    quoteId: randomUUID(),
    customerId: "cust_demo_1",
    idempotencyKey: randomUUID(),
    status: "DRAFT",
    total: 10000,
    currency: "INR",
    createdAt: now,
    updatedAt: now,
    deliveryMethod: "SHIP",
  };
  await repository.saveOrder(order, history(id, null, "DRAFT"));
  await repository.updateStatus(id, "SUBMITTED", history(id, "DRAFT", "SUBMITTED"));
  await repository.updateStatus(id, "CONFIRMED", history(id, "SUBMITTED", "CONFIRMED"));
  return { ...order, status: "CONFIRMED" };
}

function history(
  orderId: string,
  fromStatus: OrderStatus | null,
  toStatus: OrderStatus
): OrderStatusHistoryItem {
  return {
    id: randomUUID(),
    orderId,
    fromStatus,
    toStatus,
    reason: "Test setup",
    createdAt: new Date().toISOString(),
  };
}
