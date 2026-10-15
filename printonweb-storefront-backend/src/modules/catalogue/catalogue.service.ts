import { ICatalogueRepository } from "./catalogue.repository";
import { ProductListQuery, PaginatedResult, Product, PrintOption } from "./catalogue.types";
import { NotFoundError } from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";

export class CatalogueService {
  constructor(private readonly repository: ICatalogueRepository) {}

  async listProducts(query: ProductListQuery): Promise<PaginatedResult<Product>> {
    return this.repository.findProducts(query);
  }

  async getPrintOptions(productId?: string): Promise<PrintOption[]> {
    if (productId) {
      const product = await this.repository.findProductById(productId);
      if (!product) {
        throw new NotFoundError(
          `Product with id '${productId}' not found in catalogue.`,
          ErrorCodes.PRODUCT_NOT_FOUND
        );
      }
    }

    return this.repository.findPrintOptions(productId);
  }
}
