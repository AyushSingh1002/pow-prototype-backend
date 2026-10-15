import { OrderStatus } from "./order.types";
import { UnprocessableEntityError } from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";

/**
 * Allowed transitions mapping for order lifecycle.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) {
    throw new UnprocessableEntityError(
      `Cannot transition order: already in '${from}' status.`,
      ErrorCodes.INVALID_STATE_TRANSITION
    );
  }

  if (!canTransition(from, to)) {
    throw new UnprocessableEntityError(
      `Invalid order state transition from '${from}' to '${to}'. Allowed: [${ALLOWED_TRANSITIONS[from].join(", ")}]`,
      ErrorCodes.INVALID_STATE_TRANSITION
    );
  }
}
