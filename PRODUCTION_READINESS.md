# Production Readiness

## Current Status

Press & Proof is a prototype, not a production storefront. The backend now refuses to start with `NODE_ENV=production` while demo services are configured. Do not bypass that guard to deploy.

## Required Before Launch

- Replace fixed demo identities with a verified authentication provider and server-validated customer IDs.
- Implement persistent database repositories and migrations for quotes, orders, idempotency, and status history.
- Implement private object storage, signed upload flow, file type/content verification, malware scanning, and real preflight processing.
- Integrate a payment provider, signed webhook verification, retry/reconciliation handling, and payment-driven order state transitions.
- Replace sample pricing/catalogue with approved production rates, tax, shipping, and fulfillment rules.
- Persist and validate shipping/contact details; define retention and privacy policies.
- Configure `BACKEND_INTERNAL_URL` for production frontend builds, plus backend `ALLOWED_ORIGINS`, secrets, TLS, logging, monitoring, backups, and incident response.
- Run security review, dependency/license review, accessibility checks, and end-to-end tests against staging integrations.

## Current Safe Behavior

- Demo profiles are fixed and do not authenticate arbitrary `cust_*` values.
- Checkout no longer reports success when order or checkout API requests fail.
- Upload selection creates browser previews only; server metadata registration is not a file upload and is not preflight verification.
- Next.js production builds require `BACKEND_INTERNAL_URL` and do not ignore TypeScript build errors.
- The backend uses in-memory repositories and demo pricing in development/test only.
