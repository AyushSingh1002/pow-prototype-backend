import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertValidTransition,
  ALLOWED_TRANSITIONS,
} from "../../src/modules/orders/order.state-machine";
import { OrderStatus } from "../../src/modules/orders/order.types";
import { UnprocessableEntityError } from "../../src/core/errors/AppError";
import { ErrorCodes } from "../../src/core/errors/errorCodes";

describe("Order State Machine - Unit Tests", () => {
  it("allows all valid forward progression transitions", () => {
    expect(canTransition("DRAFT", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTED", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "IN_PRODUCTION")).toBe(true);
    expect(canTransition("IN_PRODUCTION", "COMPLETED")).toBe(true);

    expect(() => assertValidTransition("DRAFT", "SUBMITTED")).not.toThrow();
    expect(() => assertValidTransition("SUBMITTED", "CONFIRMED")).not.toThrow();
    expect(() => assertValidTransition("CONFIRMED", "IN_PRODUCTION")).not.toThrow();
    expect(() => assertValidTransition("IN_PRODUCTION", "COMPLETED")).not.toThrow();
  });

  it("allows cancellation from any active lifecycle stage", () => {
    const activeStates: OrderStatus[] = [
      "DRAFT",
      "SUBMITTED",
      "CONFIRMED",
      "IN_PRODUCTION",
    ];

    for (const state of activeStates) {
      expect(canTransition(state, "CANCELLED")).toBe(true);
      expect(() => assertValidTransition(state, "CANCELLED")).not.toThrow();
    }
  });

  it("rejects illegal skip transitions", () => {
    expect(canTransition("DRAFT", "COMPLETED")).toBe(false);
    expect(() => assertValidTransition("DRAFT", "COMPLETED")).toThrowError(
      UnprocessableEntityError
    );

    expect(canTransition("DRAFT", "IN_PRODUCTION")).toBe(false);
    expect(() => assertValidTransition("DRAFT", "IN_PRODUCTION")).toThrowError(
      UnprocessableEntityError
    );
  });

  it("treats COMPLETED and CANCELLED as strictly terminal states", () => {
    const allStates: OrderStatus[] = [
      "DRAFT",
      "SUBMITTED",
      "CONFIRMED",
      "IN_PRODUCTION",
      "COMPLETED",
      "CANCELLED",
    ];

    for (const target of allStates) {
      expect(canTransition("COMPLETED", target)).toBe(false);
      expect(() => assertValidTransition("COMPLETED", target)).toThrowError(
        UnprocessableEntityError
      );

      expect(canTransition("CANCELLED", target)).toBe(false);
      expect(() => assertValidTransition("CANCELLED", target)).toThrowError(
        UnprocessableEntityError
      );
    }
  });

  it("rejects self-transitions (same status to same status)", () => {
    expect(() => assertValidTransition("DRAFT", "DRAFT")).toThrowError(
      /already in 'DRAFT' status/
    );
  });
});
