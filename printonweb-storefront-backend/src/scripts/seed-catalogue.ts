import { ProductionCatalogueProduct, loadProductionCatalogue } from "../config/catalogueConfig";
import { getDatabasePool } from "../config/database";
import { PoolClient } from "pg";

async function upsertProduct(
  client: PoolClient,
  product: ProductionCatalogueProduct
): Promise<void> {
  await client.query(
    `INSERT INTO products (
       id, slug, name, description, category, is_active, min_quantity,
       max_quantity, starting_price, currency, is_sample
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       is_active = EXCLUDED.is_active,
       min_quantity = EXCLUDED.min_quantity,
       max_quantity = EXCLUDED.max_quantity,
       starting_price = EXCLUDED.starting_price,
       currency = EXCLUDED.currency,
       is_sample = false,
       updated_at = now()`,
    [
      product.id,
      product.slug,
      product.name,
      product.description,
      product.category,
      product.isActive,
      product.minQuantity,
      product.maxQuantity,
      product.sampleStartingPrice,
      product.currency,
    ]
  );
}

async function seedCatalogue(): Promise<void> {
  const catalogue = loadProductionCatalogue();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const product of catalogue.products) {
      await upsertProduct(client, product);
    }

    await client.query(
      "UPDATE products SET is_active = false, updated_at = now() WHERE NOT (id = ANY($1::text[]))",
      [catalogue.products.map((product) => product.id)]
    );

    const productIds = catalogue.products.map((product) => product.id);
    await client.query("DELETE FROM print_options WHERE product_id = ANY($1::text[])", [
      productIds,
    ]);

    for (const product of catalogue.products) {
      for (const option of product.printOptions) {
        await client.query(
          `INSERT INTO print_options (id, product_id, code, name, type, choices)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            option.id,
            option.productId,
            option.code,
            option.name,
            option.type,
            JSON.stringify(option.choices),
          ]
        );
      }
    }

    await client.query("COMMIT");
    console.log(
      `Seeded ${catalogue.products.length} approved production catalogue products (version ${catalogue.version}).`
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedCatalogue().catch((error: unknown) => {
  console.error("Production catalogue seed failed.");
  console.error(error instanceof Error ? error.message : "Unknown seed error.");
  process.exitCode = 1;
});
