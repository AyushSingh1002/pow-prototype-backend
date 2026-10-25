import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

describe("production PostgreSQL migration", () => {
  const database = new PGlite();
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(
      resolve(
        process.cwd(),
        "prisma/migrations/20261024000000_production_core.sql"
      ),
      "utf8"
    );
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
         AND table_name IN ('products', 'print_options', 'quotes', 'orders', 'files', 'fulfillment_outbox')
       ORDER BY table_name`
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "files",
      "fulfillment_outbox",
      "orders",
      "print_options",
      "products",
      "quotes",
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
});
