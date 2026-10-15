import { createApp } from "./app";
import { env } from "../config/env";

export function startServer() {
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(
      JSON.stringify({
        message: "PrintOnWeb Storefront Backend Prototype listening",
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
        pricingConfigVersion: env.PRICING_CONFIG_VERSION,
        isSample: true,
      })
    );
  });

  const shutdown = (signal: string) => {
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
