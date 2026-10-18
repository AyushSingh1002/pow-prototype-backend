import {
  OrderRecord,
  OrderStatus,
  OrderStatusHistoryItem,
} from "./order.types";
import { ConflictError } from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";

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
}

export class InMemoryOrderRepository implements IOrderRepository {
  private orders = new Map<string, OrderRecord>();
  private idempotencyIndex = new Map<string, string>(); // "customerId:idempotencyKey" -> orderId
  private history = new Map<string, OrderStatusHistoryItem[]>(); // orderId -> history items

  async saveOrder(
    order: OrderRecord,
    historyItem: OrderStatusHistoryItem
  ): Promise<OrderRecord> {
    const key = `${order.customerId}:${order.idempotencyKey}`;
    const existingOrderId = this.idempotencyIndex.get(key);
    if (existingOrderId) {
      const existing = this.orders.get(existingOrderId);
      if (existing?.quoteId === order.quoteId) return { ...existing };
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
      throw new Error(`Order ${id} not found`);
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
}
