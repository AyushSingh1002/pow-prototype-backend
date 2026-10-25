import { Pool } from "pg";
import { getDatabasePool } from "../../config/database";
import { QuoteRecord } from "./quote.types";

export interface IQuoteRepository {
  save(quote: QuoteRecord): Promise<QuoteRecord>;
  findById(id: string): Promise<QuoteRecord | null>;
  deleteExpired(now?: Date): Promise<number>;
}

export class InMemoryQuoteRepository implements IQuoteRepository {
  private quotes = new Map<string, QuoteRecord>();

  async save(quote: QuoteRecord): Promise<QuoteRecord> {
    this.quotes.set(quote.id, { ...quote });
    return { ...quote };
  }

  async findById(id: string): Promise<QuoteRecord | null> {
    const quote = this.quotes.get(id);
    return quote ? { ...quote } : null;
  }

  async deleteExpired(now: Date = new Date()): Promise<number> {
    let deletedCount = 0;
    for (const [id, record] of this.quotes.entries()) {
      if (new Date(record.expiresAt) <= now) {
        this.quotes.delete(id);
        deletedCount++;
      }
    }
    return deletedCount;
  }
}

export class PostgresQuoteRepository implements IQuoteRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async save(quote: QuoteRecord): Promise<QuoteRecord> {
    await this.pool.query(
      `INSERT INTO quotes (
        id, product_id, selected_options, quantity, line_items, total, currency,
        pricing_config_version, is_sample, tax_included, shipping_included,
        expires_at, created_at, customer_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        selected_options = EXCLUDED.selected_options,
        quantity = EXCLUDED.quantity,
        line_items = EXCLUDED.line_items,
        total = EXCLUDED.total,
        expires_at = EXCLUDED.expires_at`,
      [
        quote.id,
        quote.productId,
        quote.validatedOptions,
        quote.quantity,
        quote.lineItems,
        quote.total,
        quote.currency,
        quote.pricingConfigVersion,
        quote.isSample,
        quote.taxIncluded,
        quote.shippingIncluded,
        quote.expiresAt,
        quote.createdAt,
        quote.customerId ?? null,
      ]
    );
    return { ...quote };
  }

  async findById(id: string): Promise<QuoteRecord | null> {
    const result = await this.pool.query(
      `SELECT id, product_id, selected_options, quantity, line_items, total,
        currency, pricing_config_version, is_sample, tax_included,
        shipping_included, expires_at, created_at, customer_id
       FROM quotes WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      productId: row.product_id,
      validatedOptions: row.selected_options,
      quantity: row.quantity,
      lineItems: row.line_items,
      total: row.total,
      currency: row.currency,
      pricingConfigVersion: row.pricing_config_version,
      isSample: row.is_sample,
      taxIncluded: row.tax_included,
      shippingIncluded: row.shipping_included,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      customerId: row.customer_id ?? undefined,
    };
  }

  async deleteExpired(now: Date = new Date()): Promise<number> {
    const result = await this.pool.query("DELETE FROM quotes WHERE expires_at <= $1", [
      now,
    ]);
    return result.rowCount ?? 0;
  }
}
