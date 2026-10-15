import {
  Product,
  PrintOption,
  ProductListQuery,
  PaginatedResult,
} from "./catalogue.types";
import { sampleProducts, samplePrintOptions } from "./catalogue.sample-data";

export interface ICatalogueRepository {
  findProducts(query: ProductListQuery): Promise<PaginatedResult<Product>>;
  findProductById(id: string): Promise<Product | null>;
  findPrintOptions(productId?: string): Promise<PrintOption[]>;
}

export class InMemoryCatalogueRepository implements ICatalogueRepository {
  private products: Product[] = [...sampleProducts];
  private printOptions: PrintOption[] = [...samplePrintOptions];

  async findProducts(query: ProductListQuery): Promise<PaginatedResult<Product>> {
    let filtered = this.products.filter((p) => p.isActive);

    if (query.category) {
      filtered = filtered.filter(
        (p) => p.category.toLowerCase() === query.category?.toLowerCase()
      );
    }

    const total = filtered.length;
    const startIndex = (query.page - 1) * query.pageSize;
    const data = filtered.slice(startIndex, startIndex + query.pageSize);

    return {
      data,
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async findProductById(id: string): Promise<Product | null> {
    const product = this.products.find(
      (p) => p.id === id || p.slug === id
    );
    return product ?? null;
  }

  async findPrintOptions(productId?: string): Promise<PrintOption[]> {
    if (!productId) {
      return [...this.printOptions];
    }
    return this.printOptions.filter((opt) => opt.productId === productId);
  }
}
