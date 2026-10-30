import { createHash, randomUUID } from "node:crypto";
import {
  OrderRecord,
  OrderStatus,
  OrderStatusHistoryItem,
  StaffAccount,
  StaffOrderDetails,
  StaffQueueOrder,
  StaffCustomer,
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
    historyItem: OrderStatusHistoryItem,
    staffGuard?: { staffId: string; isAdmin: boolean }
  ): Promise<OrderRecord>;
  listStaffOrders(staffId: string): Promise<StaffQueueOrder[]>;
  getStaffOrderDetails(orderId: string, staffId: string): Promise<StaffOrderDetails | null>;
  findStaffAccount(userId: string): Promise<StaffAccount | null>;
  searchCustomers(query: string): Promise<StaffCustomer[]>;
  findCustomerById(customerId: string): Promise<StaffCustomer | null>;
  listStaffAccounts(adminId: string): Promise<StaffAccount[]>;
  claimOrder(
    orderId: string,
    staffId: string,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord>;
  releaseOrder(orderId: string, staffId: string, isAdmin: boolean): Promise<OrderRecord>;
  reassignOrder(
    orderId: string,
    adminId: string,
    assignedStaffId: string,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord>;
  addStaffNote(
    orderId: string,
    staffId: string,
    note: string,
    customerVisible: boolean
  ): Promise<void>;
  listDeadNotifications(staffId: string): Promise<Array<{ id: string; orderId: string; eventType: string; lastError: string | null }>>;
  retryNotification(id: string, staffId: string): Promise<boolean>;
  getStatusHistory(orderId: string): Promise<OrderStatusHistoryItem[]>;
  setPaymentOrderId(orderId: string, paymentOrderId: string): Promise<OrderRecord>;
  claimPaymentLinkCreation(orderId: string): Promise<boolean>;
  completePaymentLinkCreation(
    orderId: string,
    paymentLinkId: string,
    paymentLinkUrl: string,
    expiresAt: string
  ): Promise<OrderRecord>;
  markPaymentLinkCreationUnknown(orderId: string): Promise<void>;
  markPaymentLinkExpired(paymentLinkId: string): Promise<void>;
  enqueuePaymentLinkEmail(
    orderId: string,
    customerId: string,
    paymentLinkUrl: string,
    expiresAt: string
  ): Promise<void>;
  findByPaymentLinkId(paymentLinkId: string): Promise<OrderRecord | null>;
  setPaymentId(paymentOrderId: string, paymentId: string): Promise<void>;
  findByPaymentOrderId(paymentOrderId: string): Promise<OrderRecord | null>;
  claimPaymentEvent(eventId: string, eventType: string, payload: unknown): Promise<boolean>;
  finishPaymentEvent(eventId: string, processed: boolean): Promise<void>;
}

export class InMemoryOrderRepository implements IOrderRepository {
  private orders = new Map<string, OrderRecord>();
  private customers = new Map<string, StaffCustomer>();
  private idempotencyIndex = new Map<string, string>(); // "customerId:idempotencyKey" -> orderId
  private history = new Map<string, OrderStatusHistoryItem[]>(); // orderId -> history items
  private paymentEvents = new Map<string, "PROCESSING" | "FAILED" | "PROCESSED">();
  private staffAccounts = new Map<string, StaffAccount>([
    ["staff_demo_1", { id: "staff_demo_1", displayName: "Demo Staff", role: "staff" }],
  ]);
  private staffNotes = new Map<string, StaffOrderDetails["notes"]>();
  private paymentLinkEmails = new Set<string>();

  constructor(customers: StaffCustomer[] = [], initialOrders: OrderRecord[] = []) {
    for (const customer of customers) this.customers.set(customer.id, { ...customer });
    for (const order of initialOrders) {
      this.orders.set(order.id, { ...order });
      this.idempotencyIndex.set(`${order.customerId}:${order.idempotencyKey}`, order.id);
    }
  }

  async saveOrder(
    order: OrderRecord,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    const key = `${order.customerId}:${order.idempotencyKey}`;
    const existingOrderId = this.idempotencyIndex.get(key);
    if (existingOrderId) {
      const existing = this.orders.get(existingOrderId);
      if (
        existing?.quoteId === order.quoteId &&
        existing.deliveryMethod === (order.deliveryMethod ?? "SHIP") &&
        sameContact(existing.contact, order.contact)
      ) {
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
    historyItem: OrderStatusHistoryItem,
    staffGuard?: { staffId: string; isAdmin: boolean }
  ): Promise<OrderRecord> {
    const order = this.orders.get(id);
    if (!order) {
      throw new NotFoundError(
        `Order '${id}' not found.`,
        ErrorCodes.ORDER_NOT_FOUND
      );
    }
    if (order.status !== historyItem.fromStatus) {
      throw new ConflictError(
        `Order status changed from '${historyItem.fromStatus}' to '${order.status}' before this transition could be applied.`,
        ErrorCodes.INVALID_STATE_TRANSITION
      );
    }
    if (
      staffGuard &&
      newStatus === "COMPLETED" &&
      !staffGuard.isAdmin &&
      order.assignedStaffId !== staffGuard.staffId
    ) {
      throw new ConflictError("Only the assigned staff member or an admin can complete this order.", ErrorCodes.INVALID_STATE_TRANSITION);
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

  async listStaffOrders(_staffId: string): Promise<StaffQueueOrder[]> {
    return [...this.orders.values()]
      .filter((order) => ["CONFIRMED", "IN_PRODUCTION", "COMPLETED"].includes(order.status))
      .map((order) => {
        const confirmedAt = this.history.get(order.id)?.find((item) => item.toStatus === "CONFIRMED")?.createdAt
          ?? order.createdAt;
        const assigned = order.assignedStaffId
          ? this.staffAccounts.get(order.assignedStaffId)
          : undefined;
        return {
          id: order.id,
          status: order.status,
          productId: order.quoteId,
          productName: "Print order",
          quantity: 1,
          validatedOptions: {},
          deliveryMethod: order.deliveryMethod ?? "SHIP",
          confirmedAt,
          assignedStaffId: order.assignedStaffId,
          assignedStaffName: assigned?.displayName,
        };
      });
  }

  async getStaffOrderDetails(orderId: string, _staffId: string): Promise<StaffOrderDetails | null> {
    const order = this.orders.get(orderId);
    if (!order) return null;
    const queueOrder = (await this.listStaffOrders(_staffId)).find((item) => item.id === orderId);
    if (!queueOrder) return null;
    return {
      ...queueOrder,
      customerId: order.customerId,
      contact: order.contact,
      artworkFiles: [],
      notes: [...(this.staffNotes.get(orderId) ?? [])],
    };
  }

  async findStaffAccount(userId: string): Promise<StaffAccount | null> {
    const account = this.staffAccounts.get(userId);
    return account ? { ...account } : null;
  }

  async searchCustomers(query: string): Promise<StaffCustomer[]> {
    const normalized = query.trim().toLowerCase();
    return [...this.customers.values()]
      .filter((customer) =>
        customer.email.toLowerCase().includes(normalized) ||
        customer.phone?.includes(normalized)
      )
      .slice(0, 20)
      .map((customer) => ({ ...customer }));
  }

  async findCustomerById(customerId: string): Promise<StaffCustomer | null> {
    const customer = this.customers.get(customerId);
    return customer ? { ...customer } : null;
  }

  async listStaffAccounts(_adminId: string): Promise<StaffAccount[]> {
    return [...this.staffAccounts.values()].map((account) => ({ ...account }));
  }

  async claimOrder(
    orderId: string,
    staffId: string,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    const order = this.orders.get(orderId);
    if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    if (order.status !== "CONFIRMED" || order.assignedStaffId) {
      const holder = order.assignedStaffId
        ? this.staffAccounts.get(order.assignedStaffId)?.displayName ?? order.assignedStaffId
        : undefined;
      throw new ConflictError(
        holder ? `Order is already claimed by ${holder}.` : `Order is no longer claimable (status: ${order.status}).`,
        ErrorCodes.INVALID_STATE_TRANSITION
      );
    }
    const updated: OrderRecord = {
      ...order,
      status: "IN_PRODUCTION",
      assignedStaffId: staffId,
      claimedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.orders.set(orderId, updated);
    const history = this.history.get(orderId) ?? [];
    this.history.set(orderId, [...history, { ...historyItem }]);
    return { ...updated };
  }

  async releaseOrder(orderId: string, staffId: string, isAdmin: boolean): Promise<OrderRecord> {
    const order = this.orders.get(orderId);
    if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    if (order.status !== "IN_PRODUCTION" || (!isAdmin && order.assignedStaffId !== staffId)) {
      throw new ConflictError("Only the assigned staff member or an admin can release this order.", ErrorCodes.INVALID_STATE_TRANSITION);
    }
    const updated = { ...order, assignedStaffId: undefined, claimedAt: undefined, updatedAt: new Date().toISOString() };
    this.orders.set(orderId, updated);
    return { ...updated };
  }

  async reassignOrder(
    orderId: string,
    adminId: string,
    assignedStaffId: string,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    if (!this.staffAccounts.has(assignedStaffId)) {
      throw new NotFoundError("Target staff account not found.", ErrorCodes.FORBIDDEN);
    }
    const order = this.orders.get(orderId);
    if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    if (order.status !== "CONFIRMED" && order.status !== "IN_PRODUCTION") {
      throw new ConflictError(`Order cannot be assigned in '${order.status}' status.`, ErrorCodes.INVALID_STATE_TRANSITION);
    }
    const nextStatus = order.status === "CONFIRMED" ? "IN_PRODUCTION" : order.status;
    const updated = {
      ...order,
      status: nextStatus,
      assignedStaffId,
      claimedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.orders.set(orderId, updated);
    this.history.set(orderId, [...(this.history.get(orderId) ?? []), {
      ...historyItem,
      fromStatus: order.status,
      toStatus: nextStatus,
      reason: `Reassigned by admin ${adminId}`,
    }]);
    return { ...updated };
  }

  async addStaffNote(
    orderId: string,
    staffId: string,
    note: string,
    customerVisible: boolean
  ): Promise<void> {
    const order = await this.getStaffOrderDetails(orderId, staffId);
    if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    const account = await this.findStaffAccount(staffId);
    const notes = this.staffNotes.get(orderId) ?? [];
    this.staffNotes.set(orderId, [...notes, {
      id: randomUUID(),
      staffName: account?.displayName ?? staffId,
      note,
      customerVisible,
      createdAt: new Date().toISOString(),
    }]);
  }

  async listDeadNotifications(_staffId: string): Promise<Array<{ id: string; orderId: string; eventType: string; lastError: string | null }>> {
    return [];
  }

  async retryNotification(_id: string, _staffId: string): Promise<boolean> {
    return false;
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

  async claimPaymentLinkCreation(orderId: string): Promise<boolean> {
    const order = await this.findById(orderId);
    if (!order || order.status !== "SUBMITTED" || order.paymentLinkState) return false;
    this.orders.set(orderId, { ...order, paymentLinkState: "CREATING" });
    return true;
  }

  async completePaymentLinkCreation(
    orderId: string,
    paymentLinkId: string,
    paymentLinkUrl: string,
    expiresAt: string
  ): Promise<OrderRecord> {
    const order = await this.findById(orderId);
    if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    if (order.paymentLinkId) {
      if (order.paymentLinkId === paymentLinkId) return order;
      throw new ConflictError("Order already has a different payment link.");
    }
    if (order.paymentLinkState !== "CREATING") {
      throw new ConflictError("Payment link creation is not in progress.");
    }
    const updated = {
      ...order,
      paymentLinkId,
      paymentLinkUrl,
      paymentLinkExpiresAt: expiresAt,
      paymentLinkState: "CREATED" as const,
    };
    this.orders.set(orderId, updated);
    return { ...updated };
  }

  async markPaymentLinkCreationUnknown(orderId: string): Promise<void> {
    const order = await this.findById(orderId);
    if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    if (order.paymentLinkState === "CREATING") {
      this.orders.set(orderId, { ...order, paymentLinkState: "UNKNOWN" });
    }
  }

  async markPaymentLinkExpired(paymentLinkId: string): Promise<void> {
    for (const [id, order] of this.orders) {
      if (order.paymentLinkId === paymentLinkId) {
        this.orders.set(id, { ...order, paymentLinkState: "EXPIRED" });
        return;
      }
    }
    throw new NotFoundError("Payment link not found.", ErrorCodes.ORDER_NOT_FOUND);
  }

  async enqueuePaymentLinkEmail(
    orderId: string,
    _customerId: string,
    _paymentLinkUrl: string,
    _expiresAt: string
  ): Promise<void> {
    this.paymentLinkEmails.add(orderId);
  }

  async findByPaymentLinkId(paymentLinkId: string): Promise<OrderRecord | null> {
    for (const order of this.orders.values()) {
      if (order.paymentLinkId === paymentLinkId) return { ...order };
    }
    return null;
  }

  async findByPaymentOrderId(paymentOrderId: string): Promise<OrderRecord | null> {
    for (const order of this.orders.values()) {
      if (order.paymentOrderId === paymentOrderId) return { ...order };
    }
    return null;
  }

  async setPaymentId(paymentOrderId: string, paymentId: string): Promise<void> {
    const order =
      await this.findByPaymentOrderId(paymentOrderId) ??
      await this.findByPaymentLinkId(paymentOrderId);
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
          delivery_pincode, tax_amount, shipping_amount, retention_expires_at, delivery_method,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
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
          order.deliveryMethod ?? "SHIP",
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
            .update(JSON.stringify({
              quoteId: order.quoteId,
              contact: order.contact ?? null,
              deliveryMethod: order.deliveryMethod ?? "SHIP",
            }))
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
          existing.deliveryMethod === (order.deliveryMethod ?? "SHIP") &&
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
        payment_link_id, payment_link_url, payment_link_expires_at, payment_link_state,
        assigned_staff_id, claimed_at, delivery_method, delivery_deadline,
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
        payment_link_id, payment_link_url, payment_link_expires_at, payment_link_state,
        assigned_staff_id, claimed_at, delivery_method, delivery_deadline,
        created_at, updated_at
      FROM orders WHERE customer_id = $1 AND idempotency_key = $2`,
      [customerId, idempotencyKey]
    );
    return result.rows[0] ? mapOrder(result.rows[0]) : null;
  }

  async updateStatus(
    id: string,
    newStatus: OrderStatus,
    historyItem: OrderStatusHistoryItem,
    staffGuard?: { staffId: string; isAdmin: boolean }
  ): Promise<OrderRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (staffGuard) {
        await client.query(
          "SELECT set_config('request.jwt.claim.sub', $1, true)",
          [staffGuard.staffId]
        );
      }
      const updated = await client.query(
        `UPDATE orders SET status = $2, updated_at = $3
         WHERE id = $1 AND status = $4
           AND ($5::uuid IS NULL OR $6::boolean OR assigned_staff_id = $5)
         RETURNING id, quote_id, customer_id, idempotency_key, status, total,
           currency, tax_amount, shipping_amount, contact_name, contact_phone,
           delivery_address, delivery_city, delivery_pincode, payment_order_id,
           assigned_staff_id, claimed_at, delivery_method, created_at, updated_at`,
        [
          id,
          newStatus,
          historyItem.createdAt,
          historyItem.fromStatus,
          staffGuard?.staffId ?? null,
          staffGuard?.isAdmin ?? false,
        ]
      );
      if (!updated.rows[0]) {
        const current = await client.query(
          "SELECT status, assigned_staff_id FROM orders WHERE id = $1",
          [id]
        );
        if (!current.rows[0]) {
          throw new NotFoundError(`Order '${id}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
        }
        if (
          staffGuard &&
          newStatus === "COMPLETED" &&
          !staffGuard.isAdmin &&
          current.rows[0].assigned_staff_id !== staffGuard.staffId
        ) {
          throw new ConflictError(
            "Only the assigned staff member or an admin can complete this order.",
            ErrorCodes.INVALID_STATE_TRANSITION
          );
        }
        throw new ConflictError(
          `Order status changed from '${historyItem.fromStatus}' to '${current.rows[0].status}' before this transition could be applied.`,
          ErrorCodes.INVALID_STATE_TRANSITION
        );
      }
      await this.insertHistory(client, historyItem);
      const transitioned = mapOrder(updated.rows[0]);
      if (newStatus === "CONFIRMED") {
        const files = await client.query(
          "SELECT id, slot_id FROM files WHERE order_id = $1 AND status = 'scanned' ORDER BY slot_id, created_at, id",
          [transitioned.id]
        );
        await client.query(
          `INSERT INTO fulfillment_outbox (event_id, order_id, payload)
           VALUES ($1, $2, $3)
           ON CONFLICT (event_id) DO NOTHING`,
          [
            historyItem.id,
            transitioned.id,
            {
              orderId: transitioned.id,
              quoteId: transitioned.quoteId,
              customerId: transitioned.customerId,
              total: transitioned.total,
              currency: transitioned.currency,
              contact: transitioned.contact,
              artworkFiles: files.rows.map((file) => ({
                fileId: String(file.id),
                slotId: String(file.slot_id),
              })),
            },
          ]
        );
      }
      if (newStatus === "CONFIRMED" || newStatus === "COMPLETED") {
        await this.enqueueOrderNotification(client, transitioned, newStatus);
      }
      if (newStatus === "COMPLETED") {
        await client.query(
          `INSERT INTO notification_outbox (id, job_key, order_id, event_type, payload, max_attempts)
           VALUES ($1, $2, $3, 'ARTWORK_DELETE', $4, $5)
           ON CONFLICT (job_key) DO NOTHING`,
          [
            randomUUID(),
            `${transitioned.id}:ARTWORK_DELETE`,
            transitioned.id,
            { orderId: transitioned.id },
            Number(process.env.STAFF_NOTIFICATION_RETRY_MAX ?? 5),
          ]
        );
      }
      await client.query("COMMIT");
      return transitioned;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listStaffOrders(staffId: string): Promise<StaffQueueOrder[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [staffId]
      );
      const result = await client.query(
        `SELECT o.id, o.status, q.product_id, p.name AS product_name, q.quantity,
        q.selected_options, o.delivery_method, o.delivery_deadline,
        COALESCE((
          SELECT h.created_at FROM order_status_history h
          WHERE h.order_id = o.id AND h.to_status = 'CONFIRMED'
          ORDER BY h.created_at LIMIT 1
        ), o.created_at) AS confirmed_at,
        o.assigned_staff_id, sa.display_name AS assigned_staff_name
       FROM orders o
       JOIN quotes q ON q.id = o.quote_id
       JOIN products p ON p.id = q.product_id
       LEFT JOIN staff_accounts sa ON sa.user_id = o.assigned_staff_id
       WHERE o.status IN ('CONFIRMED', 'IN_PRODUCTION')
          OR (o.status = 'COMPLETED' AND o.updated_at >= date_trunc('day', now()))
       ORDER BY o.created_at`,
      );
      await client.query("COMMIT");
      return result.rows.map(mapStaffQueueOrder);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getStaffOrderDetails(orderId: string, staffId: string): Promise<StaffOrderDetails | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [staffId]
      );
      const result = await client.query(
        `SELECT o.id, o.status, o.customer_id, o.quote_id, o.contact_name,
        o.contact_phone, o.delivery_address, o.delivery_city, o.delivery_pincode,
        o.delivery_method, o.delivery_deadline, o.assigned_staff_id,
        sa.display_name AS assigned_staff_name,
        q.product_id, p.name AS product_name, q.quantity, q.selected_options,
        COALESCE((
          SELECT h.created_at FROM order_status_history h
          WHERE h.order_id = o.id AND h.to_status = 'CONFIRMED'
          ORDER BY h.created_at LIMIT 1
        ), o.created_at) AS confirmed_at
       FROM orders o
       JOIN quotes q ON q.id = o.quote_id
       JOIN products p ON p.id = q.product_id
       LEFT JOIN staff_accounts sa ON sa.user_id = o.assigned_staff_id
       WHERE o.id = $1`,
        [orderId]
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        await client.query("COMMIT");
        return null;
      }

      const [files, notes] = await Promise.all([
        client.query(
          "SELECT id, slot_id FROM files WHERE order_id = $1 AND status = 'scanned' ORDER BY slot_id, id",
          [orderId]
        ),
        client.query(
        `SELECT n.id, n.note, n.customer_visible, n.created_at, sa.display_name
         FROM staff_order_notes n
         JOIN staff_accounts sa ON sa.user_id = n.staff_user_id
         WHERE n.order_id = $1 ORDER BY n.created_at, n.id`,
          [orderId]
        ),
      ]);
      await client.query("COMMIT");
      return {
        ...mapStaffQueueOrder(row),
        customerId: String(row.customer_id),
        contact: row.contact_name
          ? {
              name: String(row.contact_name),
              phone: String(row.contact_phone),
              address: String(row.delivery_address),
              city: String(row.delivery_city),
              pincode: String(row.delivery_pincode),
            }
          : undefined,
        artworkFiles: files.rows.map((file) => ({
          fileId: String(file.id),
          slotId: String(file.slot_id),
        })),
        notes: notes.rows.map((note) => ({
          id: String(note.id),
          staffName: String(note.display_name),
          note: String(note.note),
          customerVisible: Boolean(note.customer_visible),
          createdAt: new Date(note.created_at).toISOString(),
        })),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findStaffAccount(userId: string): Promise<StaffAccount | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const result = await client.query(
        `SELECT sa.user_id, sa.display_name, sa.role
       FROM staff_accounts sa
       JOIN auth.users u ON u.id = sa.user_id
       WHERE sa.user_id = $1`,
        [userId]
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      return row
        ? { id: String(row.user_id), displayName: String(row.display_name), role: row.role }
        : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async searchCustomers(query: string): Promise<StaffCustomer[]> {
    const escaped = query.trim().replace(/[!%_]/g, "!$&");
    const result = await this.pool.query(
      `SELECT id, email, phone,
        COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email) AS display_name
       FROM auth.users
       WHERE email IS NOT NULL AND email <> ''
         AND (email ILIKE $1 ESCAPE '!' OR phone LIKE $1 ESCAPE '!')
       ORDER BY email LIMIT 20`,
      [`%${escaped}%`]
    );
    return result.rows.map(mapStaffCustomer);
  }

  async findCustomerById(customerId: string): Promise<StaffCustomer | null> {
    const result = await this.pool.query(
      `SELECT id, email, phone,
        COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email) AS display_name
       FROM auth.users WHERE id = $1 AND email IS NOT NULL AND email <> ''`,
      [customerId]
    );
    return result.rows[0] ? mapStaffCustomer(result.rows[0]) : null;
  }

  async listStaffAccounts(adminId: string): Promise<StaffAccount[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [adminId]
      );
      const result = await client.query(
        `SELECT sa.user_id, sa.display_name, sa.role
         FROM staff_accounts sa JOIN auth.users u ON u.id = sa.user_id
         ORDER BY sa.display_name`
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({
        id: String(row.user_id),
        displayName: String(row.display_name),
        role: row.role,
      }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimOrder(
    orderId: string,
    staffId: string,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [staffId]
      );
      const result = await client.query(
        `UPDATE orders
         SET assigned_staff_id = $2, status = 'IN_PRODUCTION', claimed_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'CONFIRMED' AND assigned_staff_id IS NULL
         RETURNING id, quote_id, customer_id, idempotency_key, status, total,
           currency, tax_amount, shipping_amount, contact_name, contact_phone,
           delivery_address, delivery_city, delivery_pincode, payment_order_id,
           assigned_staff_id, claimed_at, delivery_method, created_at, updated_at`,
        [orderId, staffId]
      );
      if (!result.rows[0]) {
        const current = await client.query(
          `SELECT o.status, o.assigned_staff_id, sa.display_name
           FROM orders o LEFT JOIN staff_accounts sa ON sa.user_id = o.assigned_staff_id
           WHERE o.id = $1`,
          [orderId]
        );
        if (!current.rows[0]) {
          throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
        }
        const holder = current.rows[0].display_name;
        throw new ConflictError(
          holder
            ? `Order is already claimed by ${holder}.`
            : `Order is no longer claimable (status: ${current.rows[0].status}).`,
          ErrorCodes.INVALID_STATE_TRANSITION
        );
      }
      await this.insertHistory(client, historyItem);
      await client.query("COMMIT");
      return mapOrder(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseOrder(orderId: string, staffId: string, isAdmin: boolean): Promise<OrderRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [staffId]
      );
      const result = await client.query(
      `UPDATE orders SET assigned_staff_id = NULL, claimed_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'IN_PRODUCTION'
         AND (assigned_staff_id = $2 OR $3)
       RETURNING id, quote_id, customer_id, idempotency_key, status, total,
         currency, tax_amount, shipping_amount, contact_name, contact_phone,
         delivery_address, delivery_city, delivery_pincode, payment_order_id,
         assigned_staff_id, claimed_at, delivery_method, created_at, updated_at`,
        [orderId, staffId, isAdmin]
      );
      if (!result.rows[0]) {
        const current = await client.query("SELECT id FROM orders WHERE id = $1", [orderId]);
        if (!current.rows[0]) {
          throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
        }
        throw new ConflictError(
          "Only the assigned staff member or an admin can release this order.",
          ErrorCodes.INVALID_STATE_TRANSITION
        );
      }
      await client.query("COMMIT");
      return mapOrder(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reassignOrder(
    orderId: string,
    adminId: string,
    assignedStaffId: string,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [adminId]
      );
      const target = await client.query(
        `SELECT sa.user_id FROM staff_accounts sa
         JOIN auth.users u ON u.id = sa.user_id WHERE sa.user_id = $1`,
        [assignedStaffId]
      );
      if (!target.rows[0]) {
        throw new NotFoundError("Target staff account not found.", ErrorCodes.FORBIDDEN);
      }
      const result = await client.query(
        `WITH prior AS (
           SELECT id, status FROM orders
           WHERE id = $1 AND status IN ('CONFIRMED', 'IN_PRODUCTION')
         )
         UPDATE orders o
         SET assigned_staff_id = $2,
             status = CASE WHEN prior.status = 'CONFIRMED' THEN 'IN_PRODUCTION' ELSE o.status END,
             claimed_at = now(),
             updated_at = now()
         FROM prior
         WHERE o.id = prior.id AND o.status = prior.status
         RETURNING prior.status AS prior_status, o.id, o.quote_id, o.customer_id,
           o.idempotency_key, o.status, o.total, o.currency, o.tax_amount,
           o.shipping_amount, o.contact_name, o.contact_phone, o.delivery_address,
           o.delivery_city, o.delivery_pincode, o.payment_order_id,
           o.assigned_staff_id, o.claimed_at, o.delivery_method, o.delivery_deadline,
           o.created_at, o.updated_at`,
        [orderId, assignedStaffId]
      );
      if (!result.rows[0]) {
        const current = await client.query("SELECT status FROM orders WHERE id = $1", [orderId]);
        if (!current.rows[0]) {
          throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
        }
        throw new ConflictError(
          `Order cannot be assigned in '${current.rows[0].status}' status.`,
          ErrorCodes.INVALID_STATE_TRANSITION
        );
      }
      const row = result.rows[0];
      await this.insertHistory(client, {
        ...historyItem,
        fromStatus: row.prior_status,
        toStatus: row.status,
        reason: "Reassigned by admin",
      });
      await client.query("COMMIT");
      return mapOrder(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async addStaffNote(
    orderId: string,
    staffId: string,
    note: string,
    customerVisible: boolean
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [staffId]
      );
      const order = await client.query(
        `SELECT o.id, o.customer_id, o.quote_id, q.product_id, p.name AS product_name, q.quantity
         FROM orders o JOIN quotes q ON q.id = o.quote_id JOIN products p ON p.id = q.product_id
         WHERE o.id = $1`,
        [orderId]
      );
      if (!order.rows[0]) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
      await client.query(
        `INSERT INTO staff_order_notes (id, order_id, staff_user_id, note, customer_visible)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), orderId, staffId, note, customerVisible]
      );
      await client.query(
        `INSERT INTO notification_outbox (id, job_key, order_id, event_type, payload, max_attempts)
         VALUES ($1, $2, $3, 'STAFF_PROBLEM', $4, $5)
         ON CONFLICT (job_key) DO NOTHING`,
        [
          randomUUID(),
          `${orderId}:STAFF_PROBLEM`,
          orderId,
          {
            orderId,
            productName: order.rows[0].product_name,
            quantity: Number(order.rows[0].quantity),
            note,
          },
          Number(process.env.STAFF_NOTIFICATION_RETRY_MAX ?? 5),
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDeadNotifications(staffId: string): Promise<Array<{ id: string; orderId: string; eventType: string; lastError: string | null }>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [staffId]
      );
      const result = await client.query(
      `SELECT id, order_id, event_type, last_error FROM notification_outbox
       WHERE status = 'DEAD' ORDER BY created_at DESC`
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({
      id: String(row.id),
      orderId: String(row.order_id),
      eventType: String(row.event_type),
      lastError: row.last_error ? String(row.last_error) : null,
      }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async retryNotification(id: string, staffId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [staffId]
      );
      const result = await client.query(
      `UPDATE notification_outbox
       SET status = 'PENDING', attempts = 0, last_error = NULL, next_attempt_at = now(),
         processing_started_at = NULL
       WHERE id = $1 AND status = 'DEAD'`,
         [id]
       );
       await client.query("COMMIT");
       return (result.rowCount ?? 0) === 1;
    } catch (error) {
       await client.query("ROLLBACK");
       throw error;
    } finally {
       client.release();
    }
  }

  private async enqueueOrderNotification(
    client: PoolClient,
    order: OrderRecord,
    status: "CONFIRMED" | "COMPLETED"
  ): Promise<void> {
    const details = await client.query(
      `SELECT p.name AS product_name, q.quantity, q.selected_options,
        o.delivery_method, o.delivery_address, o.delivery_city, o.delivery_pincode,
        o.delivery_deadline
       FROM orders o JOIN quotes q ON q.id = o.quote_id
       JOIN products p ON p.id = q.product_id WHERE o.id = $1`,
      [order.id]
    );
    const row = details.rows[0];
    if (!row) throw new Error(`Order '${order.id}' is missing quote/product data.`);
    const eventType = status === "CONFIRMED" ? "ORDER_CONFIRMED" : "ORDER_COMPLETED";
    await client.query(
      `INSERT INTO notification_outbox (id, job_key, order_id, event_type, payload, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_key) DO NOTHING`,
      [
        randomUUID(),
        `${order.id}:${eventType}`,
        order.id,
        eventType,
        {
          orderId: order.id,
          customerId: order.customerId,
          productName: String(row.product_name),
          quantity: Number(row.quantity),
          validatedOptions: row.selected_options,
          deliveryMethod: String(row.delivery_method),
          deadline: row.delivery_deadline
            ? new Date(row.delivery_deadline).toISOString()
            : undefined,
          address: [row.delivery_address, row.delivery_city, row.delivery_pincode]
            .filter(Boolean)
            .join(", "),
          dashboardUrl: `${process.env.STAFF_DASHBOARD_URL ?? ""}/staff/orders/${order.id}`,
        },
        Number(process.env.STAFF_NOTIFICATION_RETRY_MAX ?? 5),
      ]
    );
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

  async claimPaymentLinkCreation(orderId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE orders SET payment_link_state = 'CREATING', updated_at = now()
       WHERE id = $1 AND status = 'SUBMITTED' AND payment_link_state IS NULL`,
      [orderId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async completePaymentLinkCreation(
    orderId: string,
    paymentLinkId: string,
    paymentLinkUrl: string,
    expiresAt: string
  ): Promise<OrderRecord> {
    const result = await this.pool.query(
      `UPDATE orders SET payment_link_id = $2, payment_link_url = $3,
         payment_link_expires_at = $4, payment_link_state = 'CREATED', updated_at = now()
       WHERE id = $1 AND status = 'SUBMITTED' AND payment_link_state = 'CREATING'
         AND payment_link_id IS NULL
       RETURNING id, quote_id, customer_id, idempotency_key, status, total, currency,
         tax_amount, shipping_amount, contact_name, contact_phone, delivery_address,
         delivery_city, delivery_pincode, payment_order_id, payment_link_id,
         payment_link_url, payment_link_expires_at, payment_link_state,
         assigned_staff_id, claimed_at, delivery_method, delivery_deadline,
         created_at, updated_at`,
      [orderId, paymentLinkId, paymentLinkUrl, expiresAt]
    );
    if (result.rows[0]) return mapOrder(result.rows[0]);
    const order = await this.findById(orderId);
    if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    if (order.paymentLinkId === paymentLinkId) return order;
    throw new ConflictError("Payment link could not be saved for this order.");
  }

  async markPaymentLinkCreationUnknown(orderId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE orders SET payment_link_state = 'UNKNOWN', updated_at = now()
       WHERE id = $1 AND payment_link_state = 'CREATING'`,
      [orderId]
    );
    if (!result.rowCount) {
      const order = await this.findById(orderId);
      if (!order) throw new NotFoundError(`Order '${orderId}' not found.`, ErrorCodes.ORDER_NOT_FOUND);
    }
  }

  async markPaymentLinkExpired(paymentLinkId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE orders SET payment_link_state = 'EXPIRED', updated_at = now()
       WHERE payment_link_id = $1`,
      [paymentLinkId]
    );
    if (!result.rowCount) {
      throw new NotFoundError("Payment link not found.", ErrorCodes.ORDER_NOT_FOUND);
    }
  }

  async enqueuePaymentLinkEmail(
    orderId: string,
    customerId: string,
    paymentLinkUrl: string,
    expiresAt: string
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_outbox
         (id, job_key, order_id, event_type, payload, max_attempts)
       VALUES ($1, $2, $3, 'PAYMENT_LINK_CREATED', $4, $5)
       ON CONFLICT (job_key) DO NOTHING`,
      [
        randomUUID(),
        `${orderId}:PAYMENT_LINK_CREATED`,
        orderId,
        { orderId, customerId, paymentLinkUrl, paymentLinkExpiresAt: expiresAt },
        Number(process.env.STAFF_NOTIFICATION_RETRY_MAX ?? 5),
      ]
    );
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

  async findByPaymentLinkId(paymentLinkId: string): Promise<OrderRecord | null> {
    const result = await this.pool.query(
      `SELECT id, quote_id, customer_id, idempotency_key, status, total,
        currency, tax_amount, shipping_amount, contact_name, contact_phone,
        delivery_address, delivery_city, delivery_pincode, payment_order_id,
        payment_link_id, payment_link_url, payment_link_expires_at,
        payment_link_state, created_at, updated_at
       FROM orders WHERE payment_link_id = $1`,
      [paymentLinkId]
    );
    return result.rows[0] ? mapOrder(result.rows[0]) : null;
  }

  async setPaymentId(paymentOrderId: string, paymentId: string): Promise<void> {
    const result = await this.pool.query(
      "UPDATE orders SET payment_id = $2 WHERE payment_order_id = $1 OR payment_link_id = $1",
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
    paymentLinkId: row.payment_link_id ? String(row.payment_link_id) : undefined,
    paymentLinkUrl: row.payment_link_url ? String(row.payment_link_url) : undefined,
    paymentLinkExpiresAt: row.payment_link_expires_at
      ? new Date(row.payment_link_expires_at as string | Date).toISOString()
      : undefined,
    paymentLinkState: row.payment_link_state as OrderRecord["paymentLinkState"],
    assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : undefined,
    claimedAt: row.claimed_at
      ? new Date(row.claimed_at as string | Date).toISOString()
      : undefined,
    deliveryMethod: row.delivery_method === "PICKUP" ? "PICKUP" : "SHIP",
    deliveryDeadline: row.delivery_deadline
      ? new Date(row.delivery_deadline as string | Date).toISOString()
      : undefined,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapStaffCustomer(row: Record<string, unknown>): StaffCustomer {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    email: String(row.email),
    phone: row.phone ? String(row.phone) : undefined,
  };
}

function mapStaffQueueOrder(row: Record<string, unknown>): StaffQueueOrder {
  return {
    id: String(row.id),
    status: row.status as OrderStatus,
    productId: String(row.product_id),
    productName: String(row.product_name),
    quantity: Number(row.quantity),
    validatedOptions: row.selected_options as Record<string, string>,
    deliveryMethod: row.delivery_method === "PICKUP" ? "PICKUP" : "SHIP",
    confirmedAt: new Date(row.confirmed_at as string | Date).toISOString(),
    deadline: row.delivery_deadline
      ? new Date(row.delivery_deadline as string | Date).toISOString()
      : undefined,
    assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : undefined,
    assignedStaffName: row.assigned_staff_name ? String(row.assigned_staff_name) : undefined,
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
