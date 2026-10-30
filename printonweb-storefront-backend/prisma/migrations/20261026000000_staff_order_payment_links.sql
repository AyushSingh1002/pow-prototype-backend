ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_link_id text,
  ADD COLUMN IF NOT EXISTS payment_link_url text,
  ADD COLUMN IF NOT EXISTS payment_link_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_link_state text;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_link_state_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_payment_link_state_check
  CHECK (payment_link_state IS NULL OR payment_link_state IN ('CREATING', 'CREATED', 'UNKNOWN', 'EXPIRED'));

CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_link_id_unique
  ON orders(payment_link_id)
  WHERE payment_link_id IS NOT NULL;

ALTER TABLE notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_event_type_check;
ALTER TABLE notification_outbox
  ADD CONSTRAINT notification_outbox_event_type_check
  CHECK (event_type IN (
    'ORDER_CONFIRMED',
    'ORDER_COMPLETED',
    'STAFF_PROBLEM',
    'ARTWORK_DELETE',
    'PAYMENT_LINK_CREATED'
  ));

CREATE OR REPLACE FUNCTION guard_staff_payment_link_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_staff_role() IS NOT NULL AND (
    NEW.payment_link_id IS DISTINCT FROM OLD.payment_link_id
    OR NEW.payment_link_url IS DISTINCT FROM OLD.payment_link_url
    OR NEW.payment_link_expires_at IS DISTINCT FROM OLD.payment_link_expires_at
    OR NEW.payment_link_state IS DISTINCT FROM OLD.payment_link_state
  ) THEN
    RAISE EXCEPTION 'Staff cannot modify payment link fields'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_payment_link_fields_guard ON orders;
CREATE TRIGGER staff_payment_link_fields_guard
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_staff_payment_link_updates();
