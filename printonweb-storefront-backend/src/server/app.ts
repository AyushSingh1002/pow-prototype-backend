import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "../config/env";
import { loadPricingConfig } from "../config/pricingConfig";
import { loadProductionCatalogue } from "../config/catalogueConfig";
import { requestIdMiddleware } from "./middleware/requestId";
import { requestLoggerMiddleware } from "./middleware/requestLogger";
import { enforcePayloadLimits } from "./middleware/security";
import { errorHandlerMiddleware } from "./middleware/errorHandler";
import { InMemoryRateLimiter } from "./middleware/rateLimiter";
import {
  ICatalogueRepository,
  ConfiguredCatalogueRepository,
  InMemoryCatalogueRepository,
  PostgresCatalogueRepository,
} from "../modules/catalogue/catalogue.repository";
import { CatalogueService } from "../modules/catalogue/catalogue.service";
import {
  IQuoteRepository,
  InMemoryQuoteRepository,
  PostgresQuoteRepository,
} from "../modules/quotes/quote.repository";
import { QuoteService } from "../modules/quotes/quote.service";
import {
  IOrderRepository,
  InMemoryOrderRepository,
  PostgresOrderRepository,
} from "../modules/orders/order.repository";
import { OrderService } from "../modules/orders/order.service";
import {
  IProductionUploadService,
  StubbedUploadService,
} from "../modules/uploads/upload.service";
import { R2UploadService } from "../modules/uploads/r2-upload.service";
import {
  DemoPaymentService,
  ProductionPaymentService,
  RazorpayPaymentGateway,
} from "../modules/payments/payment.service";
import { ProductionCheckoutPricingService } from "../modules/orders/checkout-pricing.service";
import { createCatalogueRouter } from "./routes/catalogue.routes";
import { createQuoteRouter } from "./routes/quote.routes";
import { createOrderRouter } from "./routes/order.routes";
import { createDemoRouter } from "./routes/demo.routes";
import { createPaymentRouter } from "./routes/payment.routes";
import { createUploadRouter } from "./routes/upload.routes";
import { createStaffRouter } from "./routes/staff.routes";
import { PricingConfig } from "../modules/pricing/pricing.types";
import { demoStaffOrder, demoStaffQuote } from "../config/demoStaffQueue";

export interface AppDependencies {
  catalogueRepository?: ICatalogueRepository;
  quoteRepository?: IQuoteRepository;
  orderRepository?: IOrderRepository;
  uploadService?: StubbedUploadService | IProductionUploadService;
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

  if (demoServices.length > 0) {
    throw new Error(
      `Production startup is disabled: demo services are configured and must be replaced before launch: ${demoServices.join(", ")}.`
    );
  }
}

export function createApp(deps: AppDependencies = {}): Express {
  const injectedDemoServices = [
    deps.catalogueRepository instanceof InMemoryCatalogueRepository
      ? "In-memory catalogue repository"
      : undefined,
    deps.quoteRepository instanceof InMemoryQuoteRepository
      ? "In-memory quote repository"
      : undefined,
    deps.orderRepository instanceof InMemoryOrderRepository
      ? "In-memory order repository"
      : undefined,
    deps.uploadService instanceof StubbedUploadService ? "Demo upload service" : undefined,
    deps.paymentService ? "Demo payment service" : undefined,
    deps.pricingConfig?.isSample ? "Sample pricing" : undefined,
  ].filter((service): service is string => Boolean(service));
  const demoServices = env.ENABLE_DEMO_MODE
    ? [
        "In-memory repositories",
        "Sample pricing",
        "Demo auth profiles",
        "Demo upload service",
        "Demo payment service",
      ]
    : injectedDemoServices;
  assertDemoRuntimeAllowed(env.NODE_ENV, {
    enableDemoMode: env.ENABLE_DEMO_MODE,
    demoServices: env.NODE_ENV === "production" ? demoServices : [],
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
  app.use(
    express.json({
      limit: env.MAX_BODY_BYTES,
      verify: (req, _res, body) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
      },
    })
  );

  // Dependency Resolution
  const productionCatalogue = env.NODE_ENV === "production" && !env.ENABLE_DEMO_MODE
    ? loadProductionCatalogue()
    : undefined;
  const catalogueRepo = deps.catalogueRepository || (
    productionCatalogue
      ? new ConfiguredCatalogueRepository(productionCatalogue)
      : new InMemoryCatalogueRepository(env.ENABLE_DEMO_MODE)
  );
  const catalogueService = new CatalogueService(catalogueRepo);

  const pricingConfig = deps.pricingConfig || loadPricingConfig();
  const seedDemoStaffQueue =
    env.ENABLE_DEMO_MODE &&
    env.NODE_ENV !== "test" &&
    !deps.orderRepository &&
    !deps.quoteRepository;
  const quoteRepo =
    deps.quoteRepository ||
    (env.ENABLE_DEMO_MODE
      ? new InMemoryQuoteRepository(seedDemoStaffQueue ? [demoStaffQuote] : [])
      : new PostgresQuoteRepository());
  const quoteService = new QuoteService(quoteRepo, pricingConfig, env.QUOTE_TTL_MINUTES);

  const orderRepo =
    deps.orderRepository ||
    (env.ENABLE_DEMO_MODE
      ? new InMemoryOrderRepository([], seedDemoStaffQueue ? [demoStaffOrder] : [])
      : new PostgresOrderRepository());
  const orderService = new OrderService(
    orderRepo,
    quoteRepo,
    pricingConfig,
    env.ENABLE_DEMO_MODE ? undefined : new ProductionCheckoutPricingService(),
    catalogueRepo
  );

  const uploadService =
    deps.uploadService ||
    (env.ENABLE_DEMO_MODE ? new StubbedUploadService() : new R2UploadService());
  const paymentService = env.ENABLE_DEMO_MODE
    ? deps.paymentService || new DemoPaymentService()
    : undefined;
  const productionPaymentService = env.ENABLE_DEMO_MODE
    ? undefined
    : new ProductionPaymentService(
        new RazorpayPaymentGateway(),
        orderRepo,
        orderService
      );

  const rateLimiter = deps.rateLimiter || new InMemoryRateLimiter(
    env.RATE_LIMIT_WINDOW_MS,
    env.RATE_LIMIT_MAX_REQUESTS
  );

  // Mount API routers
  const apiRouter = express.Router();
  if (productionPaymentService) {
    if (!("completeUpload" in uploadService)) {
      throw new Error("Production upload service is not configured.");
    }
    apiRouter.use(createPaymentRouter(productionPaymentService, orderService));
    apiRouter.use(createUploadRouter(uploadService as IProductionUploadService, quoteService));
  }
  apiRouter.use(createCatalogueRouter(catalogueService));
  apiRouter.use(createQuoteRouter(quoteService, rateLimiter));
  apiRouter.use(createOrderRouter(orderService));
  apiRouter.use(
    createStaffRouter(orderService, uploadService, quoteService, productionPaymentService)
  );
  if (env.ENABLE_DEMO_MODE) {
    if (!paymentService) throw new Error("Demo payment service is not configured.");
    apiRouter.use(createDemoRouter(uploadService as StubbedUploadService, paymentService));
  }

  // Health check endpoint
  apiRouter.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      pricingConfigVersion: pricingConfig.version,
      isSample: pricingConfig.isSample,
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
