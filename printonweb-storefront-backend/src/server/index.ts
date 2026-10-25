import { createApp } from "./app";
import { env } from "../config/env";
import { FulfillmentOutboxWorker } from "../modules/orders/fulfillment-outbox.worker";
import { R2UploadService } from "../modules/uploads/r2-upload.service";
import { loadPricingConfig } from "../config/pricingConfig";

export function startServer() {
  const pricingConfig = loadPricingConfig();
  const app = createApp({ pricingConfig });
  const uploads = env.ENABLE_DEMO_MODE ? undefined : new R2UploadService();
  const fulfillmentWorker = env.ENABLE_DEMO_MODE
    ? undefined
    : new FulfillmentOutboxWorker(undefined, undefined, undefined, fetch, uploads);
  const stopFulfillmentWorker = fulfillmentWorker?.start();
  const runRetentionCleanup = () => {
    if (fulfillmentWorker) {
      void fulfillmentWorker.deleteExpiredContactData().catch((error: unknown) => {
        console.error("Contact-data retention cleanup failed:", error);
      });
      void fulfillmentWorker.deleteExpiredArtwork().catch((error: unknown) => {
        console.error("Artwork retention cleanup failed:", error);
      });
    }
  };
  if (fulfillmentWorker) runRetentionCleanup();
  const retentionTimer = fulfillmentWorker
    ? setInterval(runRetentionCleanup, 60 * 60 * 1000)
    : undefined;
  retentionTimer?.unref();

  const server = app.listen(env.PORT, () => {
    console.log(
      JSON.stringify({
        message: "PrintOnWeb Storefront Backend Prototype listening",
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
        pricingConfigVersion: env.PRICING_CONFIG_VERSION,
        isSample: pricingConfig.isSample,
      })
    );
  });

  const shutdown = (signal: string) => {
    stopFulfillmentWorker?.();
    if (retentionTimer) clearInterval(retentionTimer);
    console.log(
      JSON.stringify({
        message: `Received ${signal}, initiating graceful shutdown`,
      })
    );
    server.close(() => {
      console.log(JSON.stringify({ message: "Server closed gracefully." }));
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}
