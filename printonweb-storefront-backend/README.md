# PrintOnWeb-Inspired Storefront Backend Prototype

A robust, auditable backend prototype for a PrintOnWeb-inspired printing storefront. Built to establish a credible, production-aligned technical foundation for a redesign pitch without ever connecting to or modifying PrintOnWeb's live systems.

---

## 1. Prototype Scope and Ground Rules

- **Demo Configuration Only**: Sample catalogue items, option rates, quantity breaks, and setup fees are marked as sample data and are used only when `ENABLE_DEMO_MODE=true`. Production pricing must be supplied and approved separately.
- **Zero Frontend-Only Pricing or Payments**: All prices, discounts, and breakdowns are computed strictly on the server. Client-supplied totals or pricing parameters are strictly rejected at the edge.
- **Auditable Integer Money**: All monetary amounts are integers in minor units (paise/cents). No floating-point math is used. Exactly one rounding rule (`Math.round`) is applied once per line item calculation.
- **Production Integrations**: With demo mode disabled, checkout uses configured tax/shipping services, Razorpay orders/webhooks, Supabase bearer verification, private R2 uploads with scanner/preflight gates, PostgreSQL persistence, fulfillment outbox delivery, and retention cleanup. Configuration values and external provider behavior must be verified in staging before launch.
- **Selectable Repository Implementations**: `ENABLE_DEMO_MODE=true` uses the in-memory repositories and sample pricing. With demo mode disabled, catalogue, quote, and order repositories use PostgreSQL and production pricing is loaded from `PRODUCTION_PRICING_CONFIG`.

---

## 2. Architecture Overview

```
src/
├── config/
│   ├── env.ts                   # Zod-validated environment config loader
│   └── samplePricingConfig.ts   # Versioned sample pricing matrix & rules
├── core/
│   └── errors/
│       ├── AppError.ts          # Typed HTTP & domain error hierarchy
│       └── errorCodes.ts        # Unified system error codes
├── modules/
│   ├── catalogue/               # Product & Print Option catalogue
│   │   ├── catalogue.types.ts
│   │   ├── catalogue.sample-data.ts
│   │   ├── catalogue.repository.ts
│   │   └── catalogue.service.ts
│   ├── pricing/                 # Pure calculation engine
│   │   ├── pricing.types.ts
│   │   └── pricing.engine.ts    # Pure estimate(config, input) function
│   ├── quotes/                  # Auditable quote generation & lookup
│   │   ├── quote.types.ts
│   │   ├── quote.repository.ts  # In-memory repository with expiry management
│   │   └── quote.service.ts
│   ├── orders/                  # Draft orders, idempotency & state transitions
│   │   ├── order.types.ts
│   │   ├── order.state-machine.ts # Strict lifecycle state validator
│   │   ├── order.repository.ts
│   │   └── order.service.ts     # Recomputes pricing & validates expiry
│   ├── uploads/                 # Demo uploads and private R2/scanner/preflight service
│   │   ├── upload.types.ts
│   │   └── upload.service.ts
│   └── payments/                # Demo checkout and Razorpay payment/webhook service
│       ├── payment.types.ts
│       └── payment.service.ts
├── server/
│   ├── app.ts                   # Express app factory with middleware & routers
│   ├── index.ts                 # Server bootstrap & graceful shutdown
│   ├── middleware/
│   │   ├── auth.ts              # Bearer auth simulation for order creation
│   │   ├── errorHandler.ts      # Central error handler with unified error shape
│   │   ├── rateLimiter.ts       # Sliding-window in-memory rate limiter
│   │   ├── requestId.ts         # Correlation ID generator (req_...)
│   │   ├── requestLogger.ts     # Structured JSON logging
│   │   ├── security.ts          # Payload limits & Content-Type enforcement
│   │   └── validate.ts          # Zod edge request validator (.strict())
│   ├── routes/
│   │   ├── catalogue.routes.ts  # GET /api/products, GET /api/print-options
│   │   ├── quote.routes.ts      # POST /api/quotes, GET /api/quotes/:id
│   │   ├── order.routes.ts      # POST /api/orders, GET /api/orders/:id
│   │   └── demo.routes.ts       # POST /api/demo/uploads, POST /api/demo/checkout
│   └── schemas/                 # Zod contracts for request inputs
└── index.ts                     # Main entry point
```

---

## 3. API Specification

### Unified Error Shape
Every error response uniformly adheres to this shape:
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "One or more fields are invalid.",
    "details": [
      { "path": "quantity", "issue": "Must be a positive integer" }
    ],
    "requestId": "req_a1b2c3d4e5f67890"
  }
}
```

### Endpoints

| Method | Endpoint | Auth | Description | Status Codes |
|---|---|---|---|---|
| `GET` | `/api/products` | None | Lists paginated catalogue (`page`, `pageSize`, `category`) | `200`, `400` |
| `GET` | `/api/print-options` | None | Lists print options (optional `productId` filter) | `200`, `400`, `404` |
| `POST` | `/api/quotes` | None (Rate Limited) | Computes server-side quote with integer minor unit line items | `201`, `400`, `413`, `415`, `422`, `429` |
| `GET` | `/api/quotes/:id` | None | Retrieves saved quote by UUID | `200`, `400`, `404`, `410` |
| `POST` | `/api/orders` | Bearer Token | Converts valid quote to draft order with `Idempotency-Key` | `201`, `401`, `403`, `404`, `409`, `410`, `422` |
| `GET` | `/api/orders/:id` | Bearer Token | Retrieves order details and audit status history | `200`, `401`, `403`, `404` |
| `POST` | `/api/demo/uploads` | None | Artwork metadata registration & storage key generator | `201`, `413`, `422` |
| `POST` | `/api/demo/checkout` | None | Server checkout stub returning fixed demo result (₹0 charged) | `200` |
| `POST` | `/api/uploads` | Supabase | Create quote-owned presigned R2 upload | `201`, `401`, `403`, `422` |
| `POST` | `/api/uploads/:id/complete` | Supabase | Verify upload, scan, and server-side preflight | `200`, `401`, `422`, `503` |
| `GET` | `/api/uploads/:id/download` | Supabase | Issue short-lived read URL for scanned owned artwork | `200`, `401`, `404` |
| `POST` | `/api/payments/orders` | Supabase | Create/replay Razorpay order for an owned order | `201`, `401`, `403`, `422` |
| `POST` | `/api/webhooks/razorpay` | Razorpay signature | Verify and process capture/failure webhook | `200`, `400`, `409` |

---

## 4. Quality Gates and Verification

```bash
# 1. Typecheck & linting
npm run lint

# 2. Run unit and integration tests
npm test

# 3. Production build
npm run build
```

### PostgreSQL migration

Configure `DATABASE_URL` and run `npm run db:migrate` from this package to apply the idempotent SQL schema in `prisma/migrations/20261024000000_production_core.sql`. Then provide approved, non-sample `PRODUCTION_PRICING_CONFIG` and `PRODUCTION_CATALOGUE_CONFIG` JSON and run `npm run db:seed`. The catalogue configuration supplies product metadata and print-option labels/choices; its product IDs, quantity bounds, and option values must match the pricing configuration. The seeder validates both configurations before connecting, upserts configured products, deactivates products absent from the approved catalogue, and replaces print options for configured products in one transaction. It never seeds sample catalogue data. Do not run the seed command with demo or sample configuration.

The production catalogue JSON has `source`, `version`, `isSample: false`, and a non-empty `products` array. Each product has `id`, `slug`, `name`, `category`, `description`, `isActive`, `minQuantity`, `maxQuantity`, and `printOptions`. Each print option has `id`, `productId`, `code`, `name`, `type`, and a `choices` array of `{ "value", "label", "description?" }` objects. Supply only business-approved values; this repository intentionally contains no production catalogue seed data. PostgreSQL migration and seed execution still require verification against the provisioned production-like database.

### Production status

The production environment variables are listed in `.env.example`. Blank optional entries in a development `.env` file are treated as unset; when demo mode is disabled, the corresponding production settings are still required and validated. Non-demo configuration is fail-fast and rejects demo repositories and sample pricing. Provider keys, approved pricing/policies, PostgreSQL migration/seeding, and real staging verification are still required. See the workspace `PRODUCTION_READINESS.md` for the implementation completion report and remaining launch gates.
