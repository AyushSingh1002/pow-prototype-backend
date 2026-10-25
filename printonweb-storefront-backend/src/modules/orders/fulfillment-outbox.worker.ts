import { Pool } from "pg";
import { env } from "../../config/env";
import { getDatabasePool } from "../../config/database";

interface ArtworkReadUrlProvider {
  createReadUrl(fileId: string, customerId: string): Promise<string>;
  deleteExpiredFiles(limit?: number): Promise<number>;
}

export class FulfillmentOutboxWorker {
  private running = false;

  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly endpoint = env.FULFILLMENT_WEBHOOK_URL,
    private readonly token = env.FULFILLMENT_WEBHOOK_TOKEN,
    private readonly fetcher: typeof fetch = fetch,
    private readonly artworkUrls?: ArtworkReadUrlProvider
  ) {}

  async runOnce(): Promise<void> {
    if (!this.endpoint || !this.token) {
      throw new Error("Fulfillment webhook configuration is incomplete.");
    }
    const client = await this.pool.connect();
    let item: { event_id: string; payload: unknown; attempts: number } | undefined;
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT event_id, payload, attempts FROM fulfillment_outbox
         WHERE (status = 'PENDING' AND next_attempt_at <= now())
            OR (status = 'PROCESSING' AND processing_started_at <= now() - interval '2 minutes')
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED LIMIT 1`
      );
      item = result.rows[0];
      if (item) {
        await client.query(
          `UPDATE fulfillment_outbox SET status = 'PROCESSING',
           processing_started_at = now() WHERE event_id = $1`,
          [item.event_id]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!item) return;

    try {
      const payload = item.payload;
      if (
        !payload ||
        typeof payload !== "object" ||
        !("customerId" in payload) ||
        typeof payload.customerId !== "string" ||
        !("contact" in payload) ||
        !payload.contact ||
        typeof payload.contact !== "object" ||
        !("artworkFiles" in payload) ||
        !Array.isArray(payload.artworkFiles) ||
        !payload.artworkFiles.every(isArtworkFile)
      ) {
        throw new Error("Fulfillment event is missing customer or artwork metadata.");
      }
      if (!this.artworkUrls) {
        throw new Error("Private artwork URL service is not configured for fulfillment.");
      }
      const customerId = payload.customerId;
      const artworkFiles = payload.artworkFiles.filter(isArtworkFile);
      const artworkUrls = this.artworkUrls;
      const artwork = await Promise.all(
        artworkFiles.map(async (file) => ({
          fileId: file.fileId,
          slotId: file.slotId,
          downloadUrl: await artworkUrls.createReadUrl(file.fileId, customerId),
        }))
      );
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": item.event_id,
          "X-Event-Id": item.event_id,
        },
        body: JSON.stringify({ ...payload, artwork }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Fulfillment endpoint returned HTTP ${response.status}.`);
      }
      await this.pool.query(
        `UPDATE fulfillment_outbox SET status = 'DELIVERED', delivered_at = now(),
         processing_started_at = NULL,
         attempts = attempts + 1, last_error = NULL WHERE event_id = $1`,
        [item.event_id]
      );
    } catch (error) {
      const attempts = item.attempts + 1;
      const delaySeconds = Math.min(3600, 15 * 2 ** Math.min(attempts - 1, 8));
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown fulfillment error";
      await this.pool.query(
        `UPDATE fulfillment_outbox SET status = 'PENDING', processing_started_at = NULL, attempts = $2,
         last_error = $3, next_attempt_at = now() + ($4 * interval '1 second')
         WHERE event_id = $1`,
        [item.event_id, attempts, message, delaySeconds]
      );
      console.error(JSON.stringify({
        event: "fulfillment_delivery_failed",
        eventId: item.event_id,
        attempts,
        retryAfterSeconds: delaySeconds,
        error: message,
      }));
    }
  }

  start(intervalMs = 5000): () => void {
    if (this.running) throw new Error("Fulfillment outbox worker is already running.");
    this.running = true;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight || !this.running) return;
      inFlight = true;
      try {
        await this.runOnce();
      } catch (error) {
        console.error("Fulfillment outbox poll failed:", error);
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

  async deleteExpiredContactData(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
      `UPDATE orders SET contact_name = NULL, contact_phone = NULL,
       delivery_address = NULL, delivery_city = NULL, delivery_pincode = NULL
       WHERE retention_expires_at IS NOT NULL
       AND retention_expires_at <= now()
       AND contact_name IS NOT NULL RETURNING id`
      );
      if (result.rows.length) {
        await client.query(
          `UPDATE fulfillment_outbox SET payload = payload - 'contact'
           WHERE order_id = ANY($1::uuid[]) AND payload ? 'contact'`,
          [result.rows.map((row) => row.id)]
        );
      }
      await client.query("COMMIT");
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteExpiredArtwork(): Promise<number> {
    if (!this.artworkUrls) {
      throw new Error("Private artwork service is not configured for retention cleanup.");
    }
    return this.artworkUrls.deleteExpiredFiles();
  }
}

function isArtworkFile(value: unknown): value is { fileId: string; slotId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "fileId" in value &&
    typeof value.fileId === "string" &&
    "slotId" in value &&
    typeof value.slotId === "string"
  );
}
