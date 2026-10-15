import { v4 as uuidv4 } from "uuid";
import { IQuoteRepository } from "./quote.repository";
import { CreateQuoteDTO, QuoteRecord } from "./quote.types";
import { PricingConfig } from "../pricing/pricing.types";
import { estimate } from "../pricing/pricing.engine";
import { NotFoundError, GoneError } from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";

export class QuoteService {
  constructor(
    private readonly repository: IQuoteRepository,
    private readonly pricingConfig: PricingConfig,
    private readonly ttlMinutes: number = 30
  ) {}

  async createQuote(dto: CreateQuoteDTO): Promise<QuoteRecord> {
    // Pricing engine runs strictly on the server:
    // Pure function estimate(config, input)
    const breakdown = estimate(this.pricingConfig, {
      productId: dto.productId,
      options: dto.options,
      quantity: dto.quantity,
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMinutes * 60 * 1000);

    const record: QuoteRecord = {
      id: uuidv4(),
      productId: breakdown.productId,
      validatedOptions: { ...dto.options },
      quantity: breakdown.quantity,
      lineItems: breakdown.lineItems,
      total: breakdown.total,
      currency: breakdown.currency,
      pricingConfigVersion: breakdown.pricingConfigVersion,
      isSample: true,
      taxIncluded: false,
      shippingIncluded: false,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    };

    return this.repository.save(record);
  }

  async getQuoteById(id: string): Promise<QuoteRecord> {
    const record = await this.repository.findById(id);

    if (!record) {
      throw new NotFoundError(
        `Quote with id '${id}' not found.`,
        ErrorCodes.QUOTE_NOT_FOUND
      );
    }

    if (new Date(record.expiresAt) <= new Date()) {
      throw new GoneError(
        `Quote with id '${id}' has expired.`,
        ErrorCodes.QUOTE_EXPIRED
      );
    }

    return record;
  }
}
