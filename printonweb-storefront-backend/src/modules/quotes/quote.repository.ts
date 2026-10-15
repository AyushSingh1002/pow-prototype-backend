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
    if (!quote) return null;
    return { ...quote };
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
