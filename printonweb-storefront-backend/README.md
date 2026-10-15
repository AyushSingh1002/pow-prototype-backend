# PrintOnWeb-Inspired Storefront Backend Prototype

A robust, auditable backend prototype for a PrintOnWeb-inspired printing storefront. Built to establish a credible, production-aligned technical foundation for a redesign pitch without ever connecting to or modifying PrintOnWeb's live systems.

---

## 1. Prototype Scope and Ground Rules

- **Sample Configuration Only**: Every catalogue item, option rate, quantity break, and setup fee is sample data explicitly tagged with `source: "SAMPLE: not PrintOnWeb pricing"` and echoed in every response with `isSample: true`.
- **Zero Frontend-Only Pricing or Payments**: All prices, discounts, and breakdowns are computed strictly on the server. Client-supplied totals or pricing parameters are strictly rejected at the edge.
- **Auditable Integer Money**: All monetary amounts are integers in minor units (paise/cents). No floating-point math is used. Exactly one rounding rule (`Math.round`) is applied once per line item calculation.
- **Excluded by Default**: Tax and shipping are explicitly excluded (`taxIncluded: false`, `shippingIncluded: false`). Real payment capture, carrier shipping rates, and live customer accounts remain out of scope for the prototype.
- **In-Memory Architecture with Production Schema**: Default runtime uses an in-memory repository layer with strict domain interfaces. A production PostgreSQL [schema.prisma](file:///C:/Users/ASUS%20TUFF/AppData/Local/agy/bin/printonweb-storefront-backend/prisma/schema.prisma) with explicit uniqueness constraints, foreign keys, and indexes is provided for persistent deployments.

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
│   ├── uploads/                 # File artwork metadata & security stubs
│   │   ├── upload.types.ts
│   │   └── upload.service.ts
│   └── payments/                # Server demo checkout stub
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
