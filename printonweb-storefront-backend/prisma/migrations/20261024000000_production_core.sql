CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  min_quantity integer NOT NULL,
  max_quantity integer NOT NULL,
  starting_price integer NOT NULL,
  currency text NOT NULL,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_quantity > 0 AND max_quantity >= min_quantity),
  CHECK (starting_price >= 0)
);

CREATE TABLE IF NOT EXISTS print_options (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  choices jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, code)
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY,
  product_id text NOT NULL,
  selected_options jsonb NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  line_items jsonb NOT NULL,
  total integer NOT NULL CHECK (total >= 0),
  currency text NOT NULL,
  pricing_config_version text NOT NULL,
  is_sample boolean NOT NULL,
  tax_included boolean NOT NULL DEFAULT false,
  shipping_included boolean NOT NULL DEFAULT false,
  customer_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_expires_at_idx ON quotes(expires_at);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  quote_id uuid NOT NULL REFERENCES quotes(id),
  customer_id text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED')),
  total integer NOT NULL CHECK (total >= 0),
  currency text NOT NULL,
  contact_name text,
  contact_phone text,
  delivery_address text,
  delivery_city text,
  delivery_pincode text,
  payment_provider text,
  payment_order_id text,
  payment_id text,
  tax_amount integer NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  shipping_amount integer NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  retention_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders(customer_id, created_at);

CREATE TABLE IF NOT EXISTS order_status_history (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_status_history_order_created_idx ON order_status_history(order_id, created_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  customer_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  upload_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  slot_id text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  status text NOT NULL CHECK (status IN ('pending', 'uploaded', 'scanned', 'rejected')),
  page_count integer,
  minimum_dpi numeric,
  bleed_verified boolean NOT NULL DEFAULT false,
  retention_expires_at timestamptz NOT NULL,
  quote_id uuid REFERENCES quotes(id),
  order_id uuid REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_customer_idx ON files(customer_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id text PRIMARY KEY,
  provider text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'FAILED', 'PROCESSED'))
);

CREATE TABLE IF NOT EXISTS fulfillment_outbox (
  event_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DELIVERED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS fulfillment_outbox_pending_idx
  ON fulfillment_outbox(status, next_attempt_at);
