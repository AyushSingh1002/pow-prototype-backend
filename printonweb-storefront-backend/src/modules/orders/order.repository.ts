import { createHash } from "node:crypto";
import {
  OrderRecord,
  OrderStatus,
  OrderStatusHistoryItem,
} from "./order.types";
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";
import { Pool, PoolClient } from "pg";
import { getDatabasePool } from "../../config/database";
import { getRequiredArtworkSlots } from "./artwork-requirements";

export interface IOrderRepository {
  saveOrder(
    order: OrderRecord,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  findByCustomerIdAndIdempotencyKey(
    customerId: string,
    idempotencyKey: string
  ): Promise<OrderRecord | null>;
  updateStatus(
    id: string,
    newStatus: OrderStatus,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord>;
  getStatusHistory(orderId: string): Promise<OrderStatusHistoryItem[]>;
  setPaymentOrderId(orderId: string, paymentOrderId: string): Promise<OrderRecord>;
  setPaymentId(paymentOrderId: string, paymentId: string): Promise<void>;
  findByPaymentOrderId(paymentOrderId: string): Promise<OrderRecord | null>;
  claimPaymentEvent(eventId: string, eventType: string, payload: unknown): Promise<boolean>;
  finishPaymentEvent(eventId: string, processed: boolean): Promise<void>;
}

export class InMemoryOrderRepository implements IOrderRepository {
  private orders = new Map<string, OrderRecord>();
  private idempotencyIndex = new Map<string, string>(); // "customerId:idempotencyKey" -> orderId
  private history = new Map<string, OrderStatusHistoryItem[]>(); // orderId -> history items
  private paymentEvents = new Map<string, "PROCESSING" | "FAILED" | "PROCESSED">();

  async saveOrder(
    order: OrderRecord,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    const key = `${order.customerId}:${order.idempotencyKey}`;
    const existingOrderId = this.idempotencyIndex.get(key);
    if (existingOrderId) {
      const existing = this.orders.get(existingOrderId);
      if (existing?.quoteId === order.quoteId && sameContact(existing.contact, order.contact)) {
        return { ...existing };
      }
      throw new ConflictError(
        "Idempotency key was previously used with different order parameters.",
        ErrorCodes.DUPLICATE_IDEMPOTENCY_KEY
      );
    }

    this.orders.set(order.id, { ...order });
    this.idempotencyIndex.set(key, order.id);

    const existingHistory = this.history.get(order.id) || [];
    this.history.set(order.id, [...existingHistory, { ...historyItem }]);

    return { ...order };
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const order = this.orders.get(id);
    if (!order) return null;
    return { ...order };
  }

  async findByCustomerIdAndIdempotencyKey(
    customerId: string,
    idempotencyKey: string
  ): Promise<OrderRecord | null> {
    const key = `${customerId}:${idempotencyKey}`;
    const orderId = this.idempotencyIndex.get(key);
    if (!orderId) return null;
    return this.findById(orderId);
  }

  async updateStatus(
    id: string,
    newStatus: OrderStatus,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    const order = this.orders.get(id);
    if (!order) {
      throw new NotFoundError(
        `Order '${id}' not found.`,
        ErrorCodes.ORDER_NOT_FOUND
      );
    }

    const updated: OrderRecord = {
      ...order,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };
    this.orders.set(id, updated);

    const orderHistory = this.history.get(id) || [];
    this.history.set(id, [...orderHistory, { ...historyItem }]);

    return { ...updated };
  }

  async getStatusHistory(orderId: string): Promise<OrderStatusHistoryItem[]> {
    return [...(this.history.get(orderId) || [])];
  }

  async setPaymentOrderId(orderId: string, paymentOrderId: string): Promise<OrderRecord> {
    const order = await this.findById(orderId);
    if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    if (order.paymentOrderId && order.paymentOrderId !== paymentOrderId) {
      throw new ConflictError("Order already has a different payment order.");
    }
    const updated = { ...order, paymentOrderId };
    this.orders.set(orderId, updated);
    return { ...updated };
  }

  async findByPaymentOrderId(paymentOrderId: string): Promise<OrderRecord | null> {
    for (const order of this.orders.values()) {
      if (order.paymentOrderId === paymentOrderId) return { ...order };
    }
    return null;
  }

  async setPaymentId(paymentOrderId: string, paymentId: string): Promise<void> {
    const order = await this.findByPaymentOrderId(paymentOrderId);
    if (!order) throw new NotFoundError("Payment order not found.", ErrorCodes.ORDER_NOT_FOUND);
    const updated = { ...order, paymentId };
    this.orders.set(order.id, updated);
  }

  async claimPaymentEvent(
    eventId: string,
    _eventType: string,
    _payload: unknown
  ): Promise<boolean> {
    const status = this.paymentEvents.get(eventId);
    if (status === "PROCESSING" || status === "PROCESSED") return false;
    this.paymentEvents.set(eventId, "PROCESSING");
    return true;
  }

  async finishPaymentEvent(eventId: string, processed: boolean): Promise<void> {
    this.paymentEvents.set(eventId, processed ? "PROCESSED" : "FAILED");
  }
}

export class PostgresOrderRepository implements IOrderRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async saveOrder(
    order: OrderRecord,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO orders (
          id, quote_id, customer_id, idempotency_key, status, total, currency,
          contact_name, contact_phone, delivery_address, delivery_city,
          delivery_pincode, tax_amount, shipping_amount, retention_expires_at,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          order.id,
          order.quoteId,
          order.customerId,
          order.idempotencyKey,
          order.status,
          order.total,
          order.currency,
          order.contact?.name ?? null,
          order.contact?.phone ?? null,
          order.contact?.address ?? null,
          order.contact?.city ?? null,
          order.contact?.pincode ?? null,
          order.taxAmount ?? 0,
          order.shippingAmount ?? 0,
          order.contact
            ? new Date(Date.now() + Number(process.env.CONTACT_DATA_RETENTION_DAYS ?? 365) * 86_400_000)
            : null,
          order.createdAt,
          order.updatedAt,
        ]
      );
      const quoteResult = await client.query(
        "SELECT product_id, selected_options FROM quotes WHERE id = $1 AND customer_id = $2",
        [order.quoteId, order.customerId]
      );
      if (!quoteResult.rows[0]) {
        throw new UnprocessableEntityError("Quote is not owned by the order customer.");
      }
      const requiredSlots = getRequiredArtworkSlots(
        String(quoteResult.rows[0].product_id),
        quoteResult.rows[0].selected_options as Record<string, unknown>
      );
      const latestFiles = await client.query(
        `SELECT DISTINCT ON (slot_id) id, slot_id FROM files
         WHERE quote_id = $1 AND customer_id = $2 AND status = 'scanned'
           AND order_id IS NULL
         ORDER BY slot_id, created_at DESC, id DESC`,
        [order.quoteId, order.customerId]
      );
      const attachedFiles = latestFiles.rows.length
        ? await client.query(
            `UPDATE files SET order_id = $1
             WHERE id = ANY($2::uuid[])
             RETURNING id, slot_id`,
            [order.id, latestFiles.rows.map((file) => String(file.id))]
          )
        : { rows: [] as Array<{ id: string; slot_id: string }> };
      const uploadedSlots = new Set(attachedFiles.rows.map((file) => String(file.slot_id)));
      const missingSlots = requiredSlots.filter((slot) => !uploadedSlots.has(slot));
      if (missingSlots.length) {
        throw new UnprocessableEntityError(
          `Required artwork slots must pass server-side preflight before checkout: ${missingSlots.join(", ")}.`
        );
      }
      await client.query(
        `INSERT INTO idempotency_keys (customer_id, idempotency_key, request_hash, order_id)
         VALUES ($1, $2, $3, $4)`,
        [
          order.customerId,
          order.idempotencyKey,
          createHash("sha256")
            .update(JSON.stringify({ quoteId: order.quoteId, contact: order.contact ?? null }))
            .digest("hex"),
          order.id,
        ]
      );
      await this.insertHistory(client, historyItem);
      await client.query("COMMIT");
      return { ...order };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        const existing = await this.findByCustomerIdAndIdempotencyKey(
          order.customerId,
          order.idempotencyKey
        );
        if (
          existing?.quoteId === order.quoteId &&
          sameContact(existing.contact, order.contact)
        ) return existing;
        if (existing) {
          throw new ConflictError(
            "Idempotency key was previously used with different order parameters.",
            ErrorCodes.DUPLICATE_IDEMPOTENCY_KEY
          );
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const result = await this.pool.query(
      `SELECT id, quote_id, customer_id, idempotency_key, status, total,
        currency, tax_amount, shipping_amount, contact_name, contact_phone,
        delivery_address, delivery_city, delivery_pincode, payment_order_id,
        created_at, updated_at
      FROM orders WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapOrder(result.rows[0]) : null;
  }

  async findByCustomerIdAndIdempotencyKey(
    customerId: string,
    idempotencyKey: string
  ): Promise<OrderRecord | null> {
    const result = await this.pool.query(
      `SELECT id, quote_id, customer_id, idempotency_key, status, total,
        currency, tax_amount, shipping_amount, contact_name, contact_phone,
        delivery_address, delivery_city, delivery_pincode, payment_order_id,
        created_at, updated_at
      FROM orders WHERE customer_id = $1 AND idempotency_key = $2`,
      [customerId, idempotencyKey]
    );
    return result.rows[0] ? mapOrder(result.rows[0]) : null;
  }

  async updateStatus(
    id: string,
    newStatus: OrderStatus,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT status FROM orders WHERE id = $1 FOR UPDATE",
        [id]
      );
      if (!current.rows[0]) {
        throw new NotFoundError(`Order '${id}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
      }
      if (current.rows[0].status !== historyItem.fromStatus) {
        throw new ConflictError(
          "Order status changed before this transition could be applied.",
          ErrorCodes.INVALID_STATE_TRANSITION
        );
      }

      const updated = await client.query(
        `UPDATE orders SET status = $2, updated_at = $3
         WHERE id = $1 AND status = $4
         RETURNING id, quote_id, customer_id, idempotency_key, status, total,
           currency, tax_amount, shipping_amount, contact_name, contact_phone,
           delivery_address, delivery_city, delivery_pincode, payment_order_id,
           created_at, updated_at`,
        [id, newStatus, historyItem.createdAt, historyItem.fromStatus]
      );
      if (!updated.rows[0]) {
        throw new ConflictError(
          "Order status changed before this transition could be applied.",
          ErrorCodes.INVALID_STATE_TRANSITION
        );
      }
      await this.insertHistory(client, historyItem);
      if (newStatus === "CONFIRMED") {
        const confirmed = mapOrder(updated.rows[0]);
        const files = await client.query(
          "SELECT id, slot_id FROM files WHERE order_id = $1 AND status = 'scanned' ORDER BY slot_id, created_at, id",
          [confirmed.id]
        );
        await client.query(
          `INSERT INTO fulfillment_outbox (event_id, order_id, payload)
           VALUES ($1, $2, $3)
           ON CONFLICT (event_id) DO NOTHING`,
          [
            historyItem.id,
            confirmed.id,
            {
              orderId: confirmed.id,
              quoteId: confirmed.quoteId,
              customerId: confirmed.customerId,
              total: confirmed.total,
              currency: confirmed.currency,
              contact: confirmed.contact,
              artworkFiles: files.rows.map((file) => ({
                fileId: String(file.id),
                slotId: String(file.slot_id),
              })),
            },
          ]
        );
      }
      await client.query("COMMIT");
      return mapOrder(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getStatusHistory(orderId: string): Promise<OrderStatusHistoryItem[]> {
    const result = await this.pool.query(
      `SELECT id, order_id, from_status, to_status, reason, created_at
       FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id`,
      [orderId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      reason: row.reason ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async setPaymentOrderId(orderId: string, paymentOrderId: string): Promise<OrderRecord> {
    const result = await this.pool.query(
      `UPDATE orders SET payment_order_id = $2, updated_at = now()
       WHERE id = $1 AND (payment_order_id IS NULL OR payment_order_id = $2)
       RETURNING id, quote_id, customer_id, idempotency_key, status, total,
         currency, tax_amount, shipping_amount, contact_name, contact_phone,
         delivery_address, delivery_city, delivery_pincode, payment_order_id,
         created_at, updated_at`,
      [orderId, paymentOrderId]
    );
    if (result.rows[0]) return mapOrder(result.rows[0]);
    const order = await this.findById(orderId);
    if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    throw new ConflictError("Order already has a different payment order.");
  }

  async findByPaymentOrderId(paymentOrderId: string): Promise<OrderRecord | null> {
    const result = await this.pool.query(
      `SELECT id, quote_id, customer_id, idempotency_key, status, total,
        currency, tax_amount, shipping_amount, contact_name, contact_phone,
        delivery_address, delivery_city, delivery_pincode, payment_order_id,
        created_at, updated_at
       FROM orders WHERE payment_order_id = $1`,
      [paymentOrderId]
    );
    return result.rows[0] ? mapOrder(result.rows[0]) : null;
  }

  async setPaymentId(paymentOrderId: string, paymentId: string): Promise<void> {
    const result = await this.pool.query(
      "UPDATE orders SET payment_id = $2 WHERE payment_order_id = $1",
      [paymentOrderId, paymentId]
    );
    if (!result.rowCount) {
      throw new NotFoundError("Payment order not found.", ErrorCodes.ORDER_NOT_FOUND);
    }
  }

  async claimPaymentEvent(
    eventId: string,
    eventType: string,
    payload: unknown
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO webhook_events (event_id, provider, event_type, payload, status)
       VALUES ($1, 'razorpay', $2, $3, 'PROCESSING')
       ON CONFLICT (event_id) DO UPDATE SET
         status = 'PROCESSING', processing_started_at = now()
       WHERE webhook_events.status = 'FAILED'
          OR (webhook_events.status = 'PROCESSING'
              AND webhook_events.processing_started_at <= now() - interval '5 minutes')
       RETURNING event_id`,
      [eventId, eventType, payload]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async finishPaymentEvent(eventId: string, processed: boolean): Promise<void> {
    const result = await this.pool.query(
      `UPDATE webhook_events SET status = $2, processed_at = now(),
       processing_started_at = NULL WHERE event_id = $1`,
      [eventId, processed ? "PROCESSED" : "FAILED"]
    );
    if (!result.rowCount) {
      throw new Error(`Payment webhook event '${eventId}' was not claimed.`);
    }
  }

  private async insertHistory(
    client: PoolClient,
    history: OrderStatusHistoryItem
  ): Promise<void> {
    await client.query(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        history.id,
        history.orderId,
        history.fromStatus,
        history.toStatus,
        history.reason ?? null,
        history.createdAt,
      ]
    );
  }
}

function mapOrder(row: Record<string, unknown>): OrderRecord {
  return {
    id: String(row.id),
    quoteId: String(row.quote_id),
    customerId: String(row.customer_id),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as OrderStatus,
    total: Number(row.total),
    currency: String(row.currency),
    taxAmount: Number(row.tax_amount ?? 0),
    shippingAmount: Number(row.shipping_amount ?? 0),
    contact: row.contact_name
      ? {
          name: String(row.contact_name),
          phone: String(row.contact_phone),
          address: String(row.delivery_address),
          city: String(row.delivery_city),
          pincode: String(row.delivery_pincode),
        }
      : undefined,
    paymentOrderId: row.payment_order_id ? String(row.payment_order_id) : undefined,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function sameContact(
  existing: OrderRecord["contact"],
  requested: OrderRecord["contact"]
): boolean {
  return (
    existing?.name === requested?.name &&
    existing?.phone === requested?.phone &&
    existing?.address === requested?.address &&
    existing?.city === requested?.city &&
    existing?.pincode === requested?.pincode
  );
}
