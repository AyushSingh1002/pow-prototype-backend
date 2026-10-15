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
