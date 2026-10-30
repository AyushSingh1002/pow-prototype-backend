import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { NotificationOutboxWorker } from "../../src/modules/orders/notification-outbox.worker";
import { PostgresOrderRepository } from "../../src/modules/orders/order.repository";

describe("production PostgreSQL migration", () => {
  const database = new PGlite();
  let migration: string;

  beforeAll(async () => {
    await database.exec(
      "CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, phone text, raw_user_meta_data jsonb)"
    );
    const migrationDirectory = resolve(process.cwd(), "prisma/migrations");
    const migrationFiles = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    migration = (await Promise.all(
      migrationFiles.map((file) => readFile(resolve(migrationDirectory, file), "utf8"))
    )).join("\n");
    await database.exec(migration);
  });

  afterAll(async () => {
    await database.close();
  });

  it("is idempotent and creates the production catalogue tables", async () => {
    await expect(database.exec(migration)).resolves.toBeDefined();
    const result = await database.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'products', 'print_options', 'quotes', 'orders', 'files', 'fulfillment_outbox',
           'staff_accounts', 'staff_order_notes', 'notification_outbox'
         )
       ORDER BY table_name`
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "files",
      "fulfillment_outbox",
      "notification_outbox",
      "orders",
      "print_options",
      "products",
      "quotes",
      "staff_accounts",
      "staff_order_notes",
    ]);
  });

  it("enforces product quantity constraints and print-option ownership", async () => {
    await expect(
      database.query(
        `INSERT INTO products (
           id, slug, name, description, category, min_quantity, max_quantity,
           starting_price, currency
         ) VALUES ('product', 'product', 'Product', '', 'stationery', 10, 1, 0, 'INR')`
      )
    ).rejects.toThrow();

    await database.query(
      `INSERT INTO products (
         id, slug, name, description, category, min_quantity, max_quantity,
         starting_price, currency
       ) VALUES ('product', 'product', 'Product', '', 'stationery', 1, 10, 0, 'INR')`
    );

    await expect(
      database.query(
        `INSERT INTO print_options (id, product_id, code, name, type, choices)
         VALUES ('option', 'missing-product', 'size', 'Size', 'size', '[]'::jsonb)`
      )
    ).rejects.toThrow();
  });

  it("searches existing customer accounts and sends payment-link notifications by email", async () => {
    const productId = "payment-link-test-product";
    const quoteId = "23000000-0000-4000-8000-000000000001";
    const orderId = "23000000-0000-4000-8000-000000000002";
    const customerId = "23000000-0000-4000-8000-000000000003";
    await database.query(
      `INSERT INTO products (
        id, slug, name, description, category, min_quantity, max_quantity,
        starting_price, currency
      ) VALUES ($1, 'payment-link-test', 'Payment link test', '', 'books', 1, 100, 100, 'INR')`,
      [productId]
    );
    await database.query(
      `INSERT INTO auth.users (id, email, phone, raw_user_meta_data)
       VALUES ($1, 'payment-customer@example.test', '+919876543210', '{"full_name":"Payment Customer"}')`,
      [customerId]
    );
    await database.query(
      `INSERT INTO quotes (
        id, product_id, selected_options, quantity, line_items, total, currency,
        pricing_config_version, is_sample, expires_at, created_at, customer_id
      ) VALUES ($1, $2, '{}'::jsonb, 10, '[]'::jsonb, 1000, 'INR', 'test', false, now() + interval '1 day', now(), $3)`,
      [quoteId, productId, customerId]
    );
    await database.query(
      `INSERT INTO orders (
        id, quote_id, customer_id, idempotency_key, status, total, currency
      ) VALUES ($1, $2, $3, 'payment-link-test', 'SUBMITTED', 1000, 'INR')`,
      [orderId, quoteId, customerId]
    );
    const repository = new PostgresOrderRepository(createPGlitePool(database));
    const matches = await repository.searchCustomers("payment-customer@example.test");
    expect(matches).toEqual([{
      id: customerId,
      displayName: "Payment Customer",
      email: "payment-customer@example.test",
      phone: "+919876543210",
    }]);

    await repository.claimPaymentLinkCreation(orderId);
    await repository.completePaymentLinkCreation(
      orderId,
      "plink_migration_test",
      "https://rzp.io/i/plink_migration_test",
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    );
    await repository.enqueuePaymentLinkEmail(
      orderId,
      customerId,
      "https://rzp.io/i/plink_migration_test",
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    );

    const send = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("{}", { status: 200 })
    );
    const worker = new NotificationOutboxWorker(
      createPGlitePool(database),
      "test-resend-key",
      "Press & Proof <test@example.test>",
      send
    );
    await worker.runOnce();

    expect(send).toHaveBeenCalledTimes(1);
    const email = JSON.parse(String(send.mock.calls[0][1]?.body)) as {
      to: string[];
      text: string;
    };
    expect(email.to).toEqual(["payment-customer@example.test"]);
    expect(email.text).toContain("https://rzp.io/i/plink_migration_test");
    const savedOrder = await repository.findByPaymentLinkId("plink_migration_test");
    expect(savedOrder?.paymentLinkState).toBe("CREATED");
    const delivered = await database.query<{ status: string }>(
      "SELECT status FROM notification_outbox WHERE job_key = $1",
      [`${orderId}:PAYMENT_LINK_CREATED`]
    );
    expect(delivered.rows[0].status).toBe("DELIVERED");
  });

  it("wins exactly one concurrent claim and one compare-and-swap status transition", async () => {
    const productId = "staff-test-product";
    const quoteId = "21000000-0000-4000-8000-000000000001";
    const orderId = "21000000-0000-4000-8000-000000000002";
    const staffOne = "21000000-0000-4000-8000-000000000003";
    const staffTwo = "21000000-0000-4000-8000-000000000004";
    await database.query(
      `INSERT INTO products (
        id, slug, name, description, category, min_quantity, max_quantity,
        starting_price, currency
      ) VALUES ($1, 'staff-test', 'Staff test product', '', 'books', 1, 100, 100, 'INR')`,
      [productId]
    );
    await database.query("INSERT INTO auth.users (id, email) VALUES ($1, 'one@example.test'), ($2, 'two@example.test')", [staffOne, staffTwo]);
    await database.query(
      `INSERT INTO staff_accounts (user_id, display_name, role)
       VALUES ($1, 'Staff One', 'staff'), ($2, 'Staff Two', 'staff')`,
      [staffOne, staffTwo]
    );
    await database.query(
      `INSERT INTO quotes (
        id, product_id, selected_options, quantity, line_items, total, currency,
        pricing_config_version, is_sample, expires_at, created_at
      ) VALUES ($1, $2, '{}'::jsonb, 10, '[]'::jsonb, 1000, 'INR', 'test', false, now(), now())`,
      [quoteId, productId]
    );
    await database.query(
      `INSERT INTO orders (
        id, quote_id, customer_id, idempotency_key, status, total, currency
      ) VALUES ($1, $2, 'customer-test', 'staff-test', 'CONFIRMED', 1000, 'INR')`,
      [orderId, quoteId]
    );

    const claims = await Promise.all([
      database.query(
        `UPDATE orders SET assigned_staff_id = $2, status = 'IN_PRODUCTION', claimed_at = now()
         WHERE id = $1 AND status = 'CONFIRMED' AND assigned_staff_id IS NULL RETURNING id`,
        [orderId, staffOne]
      ),
      database.query(
        `UPDATE orders SET assigned_staff_id = $2, status = 'IN_PRODUCTION', claimed_at = now()
         WHERE id = $1 AND status = 'CONFIRMED' AND assigned_staff_id IS NULL RETURNING id`,
        [orderId, staffTwo]
      ),
    ]);
    expect(claims.map((result) => result.rows.length).sort()).toEqual([0, 1]);
    const holder = await database.query<{ display_name: string }>(
      `SELECT sa.display_name FROM orders o
       JOIN staff_accounts sa ON sa.user_id = o.assigned_staff_id WHERE o.id = $1`,
      [orderId]
    );
    expect(["Staff One", "Staff Two"]).toContain(holder.rows[0].display_name);

    const transitions = await Promise.all([
      database.query(
        `UPDATE orders SET status = 'COMPLETED'
         WHERE id = $1 AND status = 'IN_PRODUCTION' RETURNING id`,
        [orderId]
      ),
      database.query(
        `UPDATE orders SET status = 'COMPLETED'
         WHERE id = $1 AND status = 'IN_PRODUCTION' RETURNING id`,
        [orderId]
      ),
    ]);
    expect(transitions.map((result) => result.rows.length).sort()).toEqual([0, 1]);
  });

  it("deduplicates notification jobs and recovers a worker abandoned mid-job", async () => {
    const productId = "notification-test-product";
    const quoteId = "22000000-0000-4000-8000-000000000001";
    const orderId = "22000000-0000-4000-8000-000000000002";
    const customerId = "22000000-0000-4000-8000-000000000003";
    await database.query(
      `INSERT INTO products (
        id, slug, name, description, category, min_quantity, max_quantity,
        starting_price, currency
      ) VALUES ($1, 'notification-test', 'Notification test product', '', 'books', 1, 100, 100, 'INR')`,
      [productId]
    );
    await database.query("INSERT INTO auth.users (id, email) VALUES ($1, 'customer@example.test')", [customerId]);
    await database.query(
      `INSERT INTO quotes (
        id, product_id, selected_options, quantity, line_items, total, currency,
        pricing_config_version, is_sample, expires_at, created_at
      ) VALUES ($1, $2, '{}'::jsonb, 10, '[]'::jsonb, 1000, 'INR', 'test', false, now(), now())`,
      [quoteId, productId]
    );
    await database.query(
      `INSERT INTO orders (
        id, quote_id, customer_id, idempotency_key, status, total, currency
      ) VALUES ($1, $2, $3, 'notification-test', 'COMPLETED', 1000, 'INR')`,
      [orderId, quoteId, customerId]
    );
    const job = {
      orderId,
      customerId,
      productName: "Notification test product",
      quantity: 10,
    };
    const jobId = "22000000-0000-4000-8000-000000000004";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await database.query(
        `INSERT INTO notification_outbox (
          id, job_key, order_id, event_type, payload, status, processing_started_at
        ) VALUES ($1, $2, $3, 'ORDER_COMPLETED', $4, 'PROCESSING', now() - interval '3 minutes')
        ON CONFLICT (job_key) DO NOTHING`,
        [jobId, `${orderId}:ORDER_COMPLETED`, orderId, job]
      );
    }
    const count = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM notification_outbox WHERE job_key = $1",
      [`${orderId}:ORDER_COMPLETED`]
    );
    expect(count.rows[0].count).toBe(1);

    const adapter = createPGlitePool(database);
    const send = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 })
    );
    const worker = new NotificationOutboxWorker(
      adapter,
      "test-resend-key",
      "Press & Proof <test@example.test>",
      send
    );
    await worker.runOnce();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]?.headers).toMatchObject({
      "Idempotency-Key": `${orderId}:ORDER_COMPLETED`,
    });
    const delivered = await database.query<{ status: string }>(
      "SELECT status FROM notification_outbox WHERE id = $1",
      [jobId]
    );
    expect(delivered.rows[0].status).toBe("DELIVERED");
  });
});

function createPGlitePool(database: PGlite): Pool {
  const client = {
    query: (text: string, values?: unknown[]) => database.query(text, values),
    release: () => undefined,
  };
  return {
    connect: async () => client,
    query: (text: string, values?: unknown[]) => database.query(text, values),
  } as unknown as Pool;
}
