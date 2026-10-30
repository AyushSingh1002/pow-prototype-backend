ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_method text NOT NULL DEFAULT 'SHIP'
    CHECK (delivery_method IN ('SHIP', 'PICKUP'));

CREATE TABLE IF NOT EXISTS staff_accounts (
  user_id uuid PRIMARY KEY,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('staff', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'staff_accounts_auth_user_fk'
    )
  THEN
    ALTER TABLE staff_accounts
      ADD CONSTRAINT staff_accounts_auth_user_fk
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS staff_order_notes (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL REFERENCES staff_accounts(user_id),
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  customer_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_order_notes_order_created_idx
  ON staff_order_notes(order_id, created_at);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY,
  job_key text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('ORDER_CONFIRMED', 'ORDER_COMPLETED', 'STAFF_PROBLEM', 'ARTWORK_DELETE')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON notification_outbox(status, next_attempt_at, created_at);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_order_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION current_staff_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION current_staff_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.staff_accounts WHERE user_id = current_staff_user_id()
$$;

DROP POLICY IF EXISTS notification_jobs_admin_read ON notification_outbox;
DROP POLICY IF EXISTS staff_notification_jobs_read ON notification_outbox;
CREATE POLICY staff_notification_jobs_read ON notification_outbox
  FOR SELECT
  USING (current_staff_role() IN ('staff', 'admin'));

DROP POLICY IF EXISTS staff_accounts_self_read ON staff_accounts;
CREATE POLICY staff_accounts_self_read ON staff_accounts
  FOR SELECT
  USING (
    user_id = current_staff_user_id()
  );

DROP POLICY IF EXISTS staff_accounts_admin_read ON staff_accounts;
CREATE POLICY staff_accounts_admin_read ON staff_accounts
  FOR SELECT
  USING (current_staff_role() = 'admin');

DROP POLICY IF EXISTS staff_orders_read ON orders;
CREATE POLICY staff_orders_read ON orders
  FOR SELECT
  USING (current_staff_role() IN ('staff', 'admin'));

DROP POLICY IF EXISTS staff_orders_update ON orders;
CREATE POLICY staff_orders_update ON orders
  FOR UPDATE
  USING (
    current_staff_role() = 'admin'
    OR (
      current_staff_role() = 'staff'
      AND (
        orders.assigned_staff_id IS NULL
        OR orders.assigned_staff_id = current_staff_user_id()
      )
    )
  )
  WITH CHECK (
    current_staff_role() = 'admin'
    OR (
      current_staff_role() = 'staff'
      AND (
        assigned_staff_id IS NULL
        OR assigned_staff_id = current_staff_user_id()
      )
    )
  );

DROP POLICY IF EXISTS staff_notes_read ON staff_order_notes;
CREATE POLICY staff_notes_read ON staff_order_notes
  FOR SELECT
  USING (current_staff_role() IN ('staff', 'admin'));

DROP POLICY IF EXISTS staff_notes_insert ON staff_order_notes;
CREATE POLICY staff_notes_insert ON staff_order_notes
  FOR INSERT
  WITH CHECK (
    staff_user_id = current_staff_user_id()
    AND current_staff_role() IN ('staff', 'admin')
  );

DROP POLICY IF EXISTS notification_jobs_admin_update ON notification_outbox;
CREATE POLICY notification_jobs_admin_update ON notification_outbox
  FOR UPDATE
  USING (current_staff_role() = 'admin');

CREATE OR REPLACE FUNCTION guard_staff_order_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_id uuid;
  actor_role text;
BEGIN
  actor_id := current_staff_user_id();
  actor_role := current_staff_role();
  IF actor_role IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
    OR NEW.shipping_amount IS DISTINCT FROM OLD.shipping_amount
    OR NEW.contact_name IS DISTINCT FROM OLD.contact_name
    OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
    OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
    OR NEW.delivery_city IS DISTINCT FROM OLD.delivery_city
    OR NEW.delivery_pincode IS DISTINCT FROM OLD.delivery_pincode
    OR NEW.delivery_method IS DISTINCT FROM OLD.delivery_method
    OR NEW.delivery_deadline IS DISTINCT FROM OLD.delivery_deadline
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider
    OR NEW.payment_order_id IS DISTINCT FROM OLD.payment_order_id
    OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
    OR NEW.retention_expires_at IS DISTINCT FROM OLD.retention_expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Staff cannot modify pricing, customer, or delivery fields'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    AND NOT (
      (OLD.status = 'CONFIRMED' AND NEW.status IN ('IN_PRODUCTION', 'CANCELLED'))
      OR (OLD.status = 'IN_PRODUCTION' AND NEW.status IN ('COMPLETED', 'CANCELLED'))
    )
  THEN
    RAISE EXCEPTION 'Invalid staff order status transition'
      USING ERRCODE = '23514';
  END IF;

  IF actor_role = 'staff' AND NEW.status IS DISTINCT FROM OLD.status
    AND NOT (
      (OLD.status = 'CONFIRMED' AND NEW.status = 'IN_PRODUCTION'
        AND NEW.assigned_staff_id = actor_id)
      OR (OLD.status = 'IN_PRODUCTION' AND NEW.status = 'COMPLETED'
        AND OLD.assigned_staff_id = actor_id)
    )
  THEN
    RAISE EXCEPTION 'Staff may only claim jobs and complete their own assigned jobs'
      USING ERRCODE = '42501';
  END IF;

  IF actor_role = 'staff' AND NEW.assigned_staff_id IS NOT NULL
    AND NEW.assigned_staff_id IS DISTINCT FROM actor_id
  THEN
    RAISE EXCEPTION 'Staff cannot assign an order to another staff member'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_order_write_guard ON orders;
CREATE TRIGGER staff_order_write_guard
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_staff_order_updates();
