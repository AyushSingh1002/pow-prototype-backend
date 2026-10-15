export type OrderStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "CONFIRMED"
  | "IN_PRODUCTION"
  | "COMPLETED"
  | "CANCELLED";

export interface OrderStatusHistoryItem {
  id: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason?: string;
  createdAt: string;
}

export interface OrderRecord {
  id: string;
  quoteId: string;
  customerId: string;
  idempotencyKey: string;
  status: OrderStatus;
  total: number; // Integer minor units
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderDTO {
  quoteId: string;
  customerId: string;
  idempotencyKey: string;
}

export interface TransitionOrderDTO {
  orderId: string;
  toStatus: OrderStatus;
  reason?: string;
}
