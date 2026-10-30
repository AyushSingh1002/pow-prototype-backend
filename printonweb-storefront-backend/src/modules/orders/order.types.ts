import { PricingLineItem } from "../pricing/pricing.types";

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
  taxAmount?: number;
  shippingAmount?: number;
  contact?: DeliveryContact;
  paymentOrderId?: string;
  paymentLinkId?: string;
  paymentLinkUrl?: string;
  paymentLinkExpiresAt?: string;
  paymentLinkState?: "CREATING" | "CREATED" | "UNKNOWN" | "EXPIRED";
  assignedStaffId?: string;
  claimedAt?: string;
  deliveryMethod?: "SHIP" | "PICKUP";
  deliveryDeadline?: string;
}

export interface StaffCustomer {
  id: string;
  displayName: string;
  email: string;
  phone?: string;
}

export interface DeliveryContact {
  name: string;
  phone: string;
  address: string;
  city: string;
  pincode: string;
}

export interface CreateOrderDTO {
  quoteId: string;
  customerId: string;
  idempotencyKey: string;
  contact?: DeliveryContact;
  deliveryMethod?: "SHIP" | "PICKUP";
}

export interface TransitionOrderDTO {
  orderId: string;
  toStatus: OrderStatus;
  reason?: string;
}

export interface StaffQueueOrder {
  id: string;
  status: OrderStatus;
  productId: string;
  productName: string;
  quantity: number;
  validatedOptions: Record<string, string>;
  deliveryMethod: "SHIP" | "PICKUP";
  confirmedAt: string;
  deadline?: string;
  assignedStaffId?: string;
  assignedStaffName?: string;
}

export interface StaffOrderDetails extends StaffQueueOrder {
  customerId: string;
  contact?: DeliveryContact;
  lineItems?: PricingLineItem[];
  total?: number;
  artworkFiles: Array<{ fileId: string; slotId: string }>;
  notes: Array<{
    id: string;
    staffName: string;
    note: string;
    customerVisible: boolean;
    createdAt: string;
  }>;
}

export interface StaffAccount {
  id: string;
  displayName: string;
  role: "staff" | "admin";
}
