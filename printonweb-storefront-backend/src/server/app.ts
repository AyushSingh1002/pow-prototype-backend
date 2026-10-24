import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "../config/env";
import { samplePricingConfig } from "../config/samplePricingConfig";
import { requestIdMiddleware } from "./middleware/requestId";
import { requestLoggerMiddleware } from "./middleware/requestLogger";
import { enforcePayloadLimits } from "./middleware/security";
import { errorHandlerMiddleware } from "./middleware/errorHandler";
import { InMemoryRateLimiter } from "./middleware/rateLimiter";
import { InMemoryCatalogueRepository } from "../modules/catalogue/catalogue.repository";
import { CatalogueService } from "../modules/catalogue/catalogue.service";
import { InMemoryQuoteRepository } from "../modules/quotes/quote.repository";
import { QuoteService } from "../modules/quotes/quote.service";
import { InMemoryOrderRepository } from "../modules/orders/order.repository";
import { OrderService } from "../modules/orders/order.service";
import { StubbedUploadService } from "../modules/uploads/upload.service";
import { DemoPaymentService } from "../modules/payments/payment.service";
import { createCatalogueRouter } from "./routes/catalogue.routes";
import { createQuoteRouter } from "./routes/quote.routes";
import { createOrderRouter } from "./routes/order.routes";
import { createDemoRouter } from "./routes/demo.routes";
import { PricingConfig } from "../modules/pricing/pricing.types";

export interface AppDependencies {
  catalogueRepository?: InMemoryCatalogueRepository;
  quoteRepository?: InMemoryQuoteRepository;
  orderRepository?: InMemoryOrderRepository;
  uploadService?: StubbedUploadService;
  paymentService?: DemoPaymentService;
  pricingConfig?: PricingConfig;
  rateLimiter?: InMemoryRateLimiter;
}

export function assertDemoRuntimeAllowed(
  nodeEnv: string,
  options: { enableDemoMode?: boolean; demoServices?: string[] } = {}
): void {
  const { enableDemoMode = false, demoServices = [] } = options;

  if (nodeEnv !== "production") {
    return;
  }

  if (enableDemoMode) {
    throw new Error(
      "Production startup is disabled: ENABLE_DEMO_MODE must be false before launch."
    );
  }

  const configuredDemoServices = demoServices.length
    ? demoServices
    : [
        "In-memory repositories",
        "Sample pricing",
        "Demo auth profiles",
        "Demo upload service",
        "Demo payment service",
      ];

  throw new Error(
    `Production startup is disabled: demo services are configured and must be replaced before launch: ${configuredDemoServices.join(", ")}.`
  );
}

export function createApp(deps: AppDependencies = {}): Express {
  assertDemoRuntimeAllowed(env.NODE_ENV, {
    enableDemoMode: env.ENABLE_DEMO_MODE,
    demoServices: [
      "In-memory repositories",
      "Sample pricing",
      "Demo auth profiles",
      "Demo upload service",
      "Demo payment service",
    ],
  });

  const app = express();

  // Basic security headers
  app.use(helmet());

  // Locked-down CORS
  app.use(
    cors({
      origin: env.ALLOWED_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
    })
  );

  // Request correlation and logging
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);

  // Payload limits and content-type enforcement
  app.use(enforcePayloadLimits);

  // JSON Body Parser with explicit size cap
  app.use(express.json({ limit: env.MAX_BODY_BYTES }));

  // Dependency Resolution
  const catalogueRepo = deps.catalogueRepository || new InMemoryCatalogueRepository();
  const catalogueService = new CatalogueService(catalogueRepo);

  const pricingConfig = deps.pricingConfig || samplePricingConfig;
  const quoteRepo = deps.quoteRepository || new InMemoryQuoteRepository();
  const quoteService = new QuoteService(quoteRepo, pricingConfig, env.QUOTE_TTL_MINUTES);

  const orderRepo = deps.orderRepository || new InMemoryOrderRepository();
  const orderService = new OrderService(orderRepo, quoteRepo, pricingConfig);

  const uploadService = deps.uploadService || new StubbedUploadService();
  const paymentService = deps.paymentService || new DemoPaymentService();

  const rateLimiter = deps.rateLimiter || new InMemoryRateLimiter(
    env.RATE_LIMIT_WINDOW_MS,
    env.RATE_LIMIT_MAX_REQUESTS
  );

  // Mount API routers
  const apiRouter = express.Router();
  apiRouter.use(createCatalogueRouter(catalogueService));
  apiRouter.use(createQuoteRouter(quoteService, rateLimiter));
  apiRouter.use(createOrderRouter(orderService));
  apiRouter.use(createDemoRouter(uploadService, paymentService));

  // Health check endpoint
  apiRouter.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      pricingConfigVersion: pricingConfig.version,
      isSample: true,
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api", apiRouter);

  // 404 Handler for unknown routes
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `Endpoint '${req.method} ${req.originalUrl}' not found.`,
        requestId: req.id,
      },
    });
  });

  // Central Error Handler
  app.use(errorHandlerMiddleware);

  return app;
}
