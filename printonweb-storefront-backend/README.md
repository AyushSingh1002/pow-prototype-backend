# PrintOnWeb-Inspired Storefront Backend Prototype

A robust, auditable backend prototype for a PrintOnWeb-inspired printing storefront. Built to establish a credible, production-aligned technical foundation for a redesign pitch without ever connecting to or modifying PrintOnWeb's live systems.

---

## 1. Prototype Scope and Ground Rules

- **Demo Configuration Only**: Sample catalogue items, option rates, quantity breaks, and setup fees are marked as sample data and are used only when `ENABLE_DEMO_MODE=true`. Production pricing must be supplied and approved separately.
- **Zero Frontend-Only Pricing or Payments**: All prices, discounts, and breakdowns are computed strictly on the server. Client-supplied totals or pricing parameters are strictly rejected at the edge.
- **Auditable Integer Money**: All monetary amounts are integers in minor units (paise/cents). No floating-point math is used. Exactly one rounding rule (`Math.round`) is applied once per line item calculation.
- **Production Integrations**: With demo mode disabled, checkout uses configured tax/shipping services, Razorpay orders/webhooks, Supabase bearer verification, private R2 uploads with scanner/preflight gates, PostgreSQL persistence, fulfillment and notification outboxes, and retention cleanup. Staff notifications use Resend. Configuration values and external provider behavior must be verified in staging before launch.
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
| `GET` | `/api/staff/orders` | Staff Supabase session | Queue of confirmed, in-production, and completed-today jobs | `200`, `401`, `403` |
| `GET` | `/api/staff/accounts` | Admin Supabase session | List active staff assignment targets | `200`, `401`, `403` |
| `GET` | `/api/staff/orders/:id` | Staff Supabase session | Full ticket and five-minute signed artwork links | `200`, `401`, `403`, `404` |
| `POST` | `/api/staff/orders/:id/claim` | Staff Supabase session | Atomically claim a confirmed job | `200`, `401`, `403`, `404`, `409` |
| `POST` | `/api/staff/orders/:id/release` | Staff Supabase session | Release an assigned production job | `200`, `401`, `403`, `404`, `409` |
| `POST` | `/api/staff/orders/:id/assign` | Admin Supabase session | Assign or reassign an active production job | `200`, `401`, `403`, `404`, `409` |
| `POST` | `/api/staff/orders/:id/complete` | Staff Supabase session | Atomically complete the assigned job and enqueue customer notification/artwork cleanup | `200`, `401`, `403`, `404`, `409` |
| `POST` | `/api/staff/orders/:id/problems` | Staff Supabase session | Record a staff note and enqueue an operations alert | `201`, `401`, `403`, `404` |
| `GET` | `/api/staff/customers?query=...` | Staff Supabase session | Search existing customer accounts by email or phone | `200`, `400`, `401`, `403` |
| `GET` | `/api/staff/customers/:id/quotes` | Staff Supabase session | List that customer's active, non-sample quotes | `200`, `401`, `403`, `404` |
| `POST` | `/api/staff/orders` | Staff Supabase session | Create an order from the customer's quote and email a 24-hour Razorpay payment link | `201`, `400`, `401`, `403`, `404`, `409`, `422`, `503` |
| `POST` | `/api/staff/notifications/:id/retry` | Admin Supabase session | Requeue a dead-letter notification | `202`, `401`, `403`, `404` |

---

## 4. Staff Fulfillment

The staff workspace is separate from the storefront at `/staff`; a per-order ticket is available at `/staff/orders/:id`. It uses a distinct staff session check. In demo mode, the fixed staff login uses `demo-staff-token` and the in-memory notification queue intentionally does not send email.

PostgreSQL order transitions use compare-and-swap updates with the observed status in the `WHERE` clause. Claiming is the stricter atomic operation:

```sql
UPDATE orders
SET assigned_staff_id = $2, status = 'IN_PRODUCTION', claimed_at = now(), updated_at = now()
WHERE id = $1 AND status = 'CONFIRMED' AND assigned_staff_id IS NULL
RETURNING *;
```

The transition history and any resulting notification/outbox event are committed in the same transaction. The existing PostgreSQL outbox worker pattern is reused instead of introducing pg-boss: it already uses durable Postgres rows and `FOR UPDATE SKIP LOCKED`, and allows the state write and uniquely keyed `(order_id, event_type)` job to be atomic without adding a second queue schema/worker. Jobs retry with exponential backoff and move to `DEAD` after `STAFF_NOTIFICATION_RETRY_MAX`; administrators can retry them from the staff dashboard. Resend is the confirmed email provider (`EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`), and `STAFF_DASHBOARD_URL` supplies absolute ticket links. The staff queue refreshes every three seconds; atomic claims, not refresh timing, prevent double assignment.

Delivery deadlines are nullable because the existing checkout flow has no requested-delivery-date or SLA source. Tickets sort populated deadlines first and show “Not set” otherwise; a business-approved deadline source must be wired before all production jobs can display a due date.

Checkout accepts either `SHIP` or `PICKUP`. Pickup does not require a delivery address and is priced with zero shipping; shipping continues to require a contact and a configured shipping-rate provider.

---

## 5. Quality Gates and Verification

```bash
# 1. Typecheck & linting
npm run lint

# 2. Run unit and integration tests
npm test

# 3. Production build
npm run build
```

### PostgreSQL migration

Configure `DATABASE_URL` and run `npm run db:migrate` from this package to apply all idempotent SQL migrations in order, including the staff fulfillment migration. Then provide approved, non-sample `PRODUCTION_PRICING_CONFIG` and `PRODUCTION_CATALOGUE_CONFIG` JSON and run `npm run db:seed`. The catalogue configuration supplies product metadata and print-option labels/choices; its product IDs, quantity bounds, and option values must match the pricing configuration. The seeder validates both configurations before connecting, upserts configured products, deactivates products absent from the approved catalogue, and replaces print options for configured products in one transaction. It never seeds sample catalogue data. Do not run the seed command with demo or sample configuration.

The production catalogue JSON has `source`, `version`, `isSample: false`, and a non-empty `products` array. Each product has `id`, `slug`, `name`, `category`, `description`, `isActive`, `minQuantity`, `maxQuantity`, and `printOptions`. Each print option has `id`, `productId`, `code`, `name`, `type`, and a `choices` array of `{ "value", "label", "description?" }` objects. Supply only business-approved values; this repository intentionally contains no production catalogue seed data. PostgreSQL migration and seed execution still require verification against the provisioned production-like database.

### Production status

With `ENABLE_DEMO_MODE=false`, configure Razorpay using `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. The webhook secret is used to verify raw request bytes; invalid or missing signatures are rejected with HTTP 400. A browser checkout callback is not treated as payment confirmation: the order remains pending until the signed webhook transitions it through the order state machine.

Staff-created orders can only use an existing customer's active, non-sample quote and still pass through normal order, artwork, and server-side pricing validation. The server creates a full-amount, non-partial Razorpay Payment Link that expires after 24 hours, disables Razorpay's own SMS/email sends, and queues a single customer email through the existing Resend outbox. Subscribe the webhook to `payment_link.paid` and `payment_link.expired`; a paid event confirms the order, and an expired unpaid link cancels it. Staff-created pickup is intentionally disabled until an approved location is configured.

With `ENABLE_DEMO_MODE=true`, the in-memory staff queue includes a clearly labeled sample confirmed order and quote. The fixed `Demo Staff` identity can open its ticket and exercise claim/release/complete without a Supabase session; the fixture is never loaded in production mode or when repositories are injected.

The production environment variables are listed in `.env.example`. Blank optional entries in a development `.env` file are treated as unset; when demo mode is disabled, the corresponding production settings are still required and validated. Non-demo configuration is fail-fast and rejects demo repositories and sample pricing. Provider keys, approved pricing/policies, PostgreSQL migration/seeding, and real staging verification are still required. See the workspace `PRODUCTION_READINESS.md` for the implementation completion report and remaining launch gates.
