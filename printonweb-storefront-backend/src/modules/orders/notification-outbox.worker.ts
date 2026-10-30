import { Pool } from "pg";
import { env } from "../../config/env";
import { getDatabasePool } from "../../config/database";

interface ArtworkDeletionProvider {
  deleteOrderArtwork(orderId: string): Promise<number>;
}

interface NotificationJob {
  id: string;
  job_key: string;
  order_id: string;
  event_type:
    | "ORDER_CONFIRMED"
    | "ORDER_COMPLETED"
    | "STAFF_PROBLEM"
    | "PAYMENT_LINK_CREATED"
    | "ARTWORK_DELETE";
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

interface NotificationPayload {
  orderId: string;
  customerId?: string;
  productName?: string;
  quantity?: number;
  validatedOptions?: Record<string, string>;
  deliveryMethod?: string;
  address?: string;
  dashboardUrl?: string;
  note?: string;
  deadline?: string;
  paymentLinkUrl?: string;
  paymentLinkExpiresAt?: string;
}

type TemplateData = {
  orderId: string;
  productName: string;
  quantity: number;
  detailUrl: string;
  note?: string;
  deadline?: string;
  options?: string;
  deliveryMethod?: string;
  address?: string;
  paymentLinkUrl?: string;
  paymentLinkExpiresAt?: string;
};

const templates = {
  ORDER_CONFIRMED: (data: TemplateData) => ({
    subject: `New print job: ${data.productName}`,
    text: `New confirmed job ${data.orderId}: ${data.quantity} × ${data.productName}. Deadline: ${data.deadline ?? "not set"}. Delivery: ${data.deliveryMethod ?? "not specified"} ${data.address ?? ""}. Options: ${data.options ?? "see job ticket"}. Open the staff dashboard: ${data.detailUrl}`,
    html: `<p>A new print job is ready.</p><p><strong>${escapeHtml(data.productName)}</strong> · ${data.quantity} copies</p><p>Deadline: ${escapeHtml(data.deadline ?? "Not set")}<br>Delivery: ${escapeHtml(data.deliveryMethod ?? "Not specified")} ${escapeHtml(data.address ?? "")}<br>Options: ${escapeHtml(data.options ?? "See job ticket")}</p><p>Order ${escapeHtml(data.orderId)}</p><p><a href="${escapeHtml(data.detailUrl)}">Open job ticket</a></p>`,
  }),
  ORDER_COMPLETED: (data: TemplateData) => ({
    subject: `Your print order is ready`,
    text: `Your order ${data.orderId} (${data.productName}) is complete and ready.`,
    html: `<p>Your print order is ready.</p><p>${escapeHtml(data.productName)} · ${data.quantity} copies</p><p>Order ${escapeHtml(data.orderId)} is complete.</p>`,
  }),
  STAFF_PROBLEM: (data: TemplateData) => ({
    subject: `Print job needs attention: ${data.productName}`,
    text: `Order ${data.orderId} needs attention: ${data.note ?? "A staff member flagged a problem."} ${data.detailUrl}`,
    html: `<p>A print job needs attention.</p><p>${escapeHtml(data.productName)} · order ${escapeHtml(data.orderId)}</p><p>${escapeHtml(data.note ?? "")}</p><p><a href="${escapeHtml(data.detailUrl)}">Open job ticket</a></p>`,
  }),
  PAYMENT_LINK_CREATED: (data: TemplateData) => ({
    subject: `Payment link for your print order ${data.orderId}`,
    text: `Your print order ${data.orderId} is ready for payment. Complete payment by ${data.paymentLinkExpiresAt ?? "the link expiry shown at checkout"}: ${data.paymentLinkUrl ?? ""}`,
    html: `<p>Your print order is ready for payment.</p><p>Order ${escapeHtml(data.orderId)}</p><p>Complete payment by ${escapeHtml(data.paymentLinkExpiresAt ?? "the expiry shown at checkout")}.</p><p><a href="${escapeHtml(data.paymentLinkUrl ?? "")}">Pay securely with Razorpay</a></p>`,
  }),
};

export class NotificationOutboxWorker {
  private running = false;

  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly apiKey = env.EMAIL_PROVIDER_API_KEY,
    private readonly fromAddress = env.EMAIL_FROM_ADDRESS,
    private readonly fetcher: typeof fetch = fetch,
    private readonly artwork?: ArtworkDeletionProvider
  ) {}

  async runOnce(): Promise<void> {
    if (!this.apiKey || !this.fromAddress) {
      throw new Error("Resend email configuration is incomplete.");
    }

    const client = await this.pool.connect();
    let job: NotificationJob | undefined;
    try {
      await client.query("BEGIN");
      const result = await client.query<NotificationJob>(
        `SELECT id, job_key, order_id, event_type, payload, attempts, max_attempts
         FROM notification_outbox
         WHERE (status = 'PENDING' AND next_attempt_at <= now())
            OR (status = 'PROCESSING' AND processing_started_at <= now() - interval '2 minutes')
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED LIMIT 1`
      );
      job = result.rows[0];
      if (job) {
        await client.query(
          `UPDATE notification_outbox SET status = 'PROCESSING',
           processing_started_at = now() WHERE id = $1`,
          [job.id]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!job) return;

    try {
      if (job.event_type === "ARTWORK_DELETE") {
        if (!this.artwork) throw new Error("Artwork deletion service is unavailable.");
        await this.artwork.deleteOrderArtwork(job.order_id);
      } else {
        await this.sendNotification(job);
      }
      await this.pool.query(
        `UPDATE notification_outbox SET status = 'DELIVERED', delivered_at = now(),
         processing_started_at = NULL, attempts = attempts + 1, last_error = NULL
         WHERE id = $1`,
        [job.id]
      );
    } catch (error) {
      const attempts = job.attempts + 1;
      const isDead = attempts >= job.max_attempts;
      const delaySeconds = Math.min(3600, 15 * 2 ** Math.min(attempts - 1, 8));
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown notification error";
      await this.pool.query(
        `UPDATE notification_outbox
         SET status = $2, processing_started_at = NULL, attempts = $3,
           last_error = $4,
           next_attempt_at = now() + ($5 * interval '1 second')
         WHERE id = $1`,
        [job.id, isDead ? "DEAD" : "PENDING", attempts, message, delaySeconds]
      );
      console.error(JSON.stringify({
        event: "notification_delivery_failed",
        jobId: job.id,
        jobKey: job.job_key,
        attempts,
        deadLettered: isDead,
        retryAfterSeconds: isDead ? undefined : delaySeconds,
        error: message,
      }));
    }
  }

  start(intervalMs = 5000): () => void {
    if (this.running) throw new Error("Notification outbox worker is already running.");
    if (!this.apiKey || !this.fromAddress) {
      throw new Error("Resend email configuration is incomplete.");
    }
    this.running = true;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight || !this.running) return;
      inFlight = true;
      try {
        await this.runOnce();
      } catch (error) {
        console.error("Notification outbox poll failed:", error);
      } finally {
        inFlight = false;
      }
    }, intervalMs);
    timer.unref();
    return () => {
      this.running = false;
      clearInterval(timer);
    };
  }

  private async sendNotification(job: NotificationJob): Promise<void> {
    if (job.event_type === "ARTWORK_DELETE") {
      throw new Error("Artwork deletion jobs cannot be sent as email.");
    }
    const payload = parsePayload(job.payload, job.order_id);
    if (
      job.event_type === "PAYMENT_LINK_CREATED" &&
      (!payload.paymentLinkUrl || !payload.paymentLinkExpiresAt)
    ) {
      throw new Error("Payment-link notification is missing the link or expiry.");
    }
    const recipients = await this.getRecipients(job, payload);
    if (!recipients.length) throw new Error("Notification has no eligible recipients.");

    const template = templates[job.event_type];
    const message = template({
      orderId: payload.orderId,
      productName: payload.productName ?? "Print order",
      quantity: payload.quantity ?? 1,
      detailUrl: payload.dashboardUrl ?? `${env.STAFF_DASHBOARD_URL ?? ""}/staff/orders/${payload.orderId}`,
      note: payload.note,
      deadline: payload.deadline,
      options: payload.validatedOptions
        ? Object.entries(payload.validatedOptions).map(([key, value]) => `${key}: ${value}`).join(", ")
        : undefined,
      deliveryMethod: payload.deliveryMethod,
      address: payload.address,
      paymentLinkUrl: payload.paymentLinkUrl,
      paymentLinkExpiresAt: payload.paymentLinkExpiresAt,
    });

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await this.fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": job.job_key,
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: recipients,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("Resend email API is unavailable.");
    }
    if (!response.ok) {
      throw new Error(`Resend rejected the notification with HTTP ${response.status}.`);
    }
  }

  private async getRecipients(job: NotificationJob, payload: NotificationPayload): Promise<string[]> {
    const result = job.event_type === "ORDER_COMPLETED" || job.event_type === "PAYMENT_LINK_CREATED"
      ? await this.pool.query(
          "SELECT email FROM auth.users WHERE id = $1 AND email IS NOT NULL",
          [payload.customerId]
        )
      : await this.pool.query(
          `SELECT u.email FROM staff_accounts sa
           JOIN auth.users u ON u.id = sa.user_id
           WHERE ($1 = 'all' OR sa.role = $1) AND u.email IS NOT NULL`,
          [
            job.event_type === "STAFF_PROBLEM"
              ? "admin"
              : job.event_type === "ORDER_CONFIRMED"
                ? "all"
                : "staff",
          ]
        );
    return result.rows.map((row) => String(row.email));
  }
}

function parsePayload(value: unknown, orderId: string): NotificationPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Notification payload is invalid.");
  }
  const payload = value as Partial<NotificationPayload>;
  if (payload.orderId !== orderId) {
    throw new Error("Notification payload order does not match its job.");
  }
  if (typeof payload.customerId !== "string" && !payload.note) {
    throw new Error("Notification payload is missing customer or problem details.");
  }
  return payload as NotificationPayload;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
