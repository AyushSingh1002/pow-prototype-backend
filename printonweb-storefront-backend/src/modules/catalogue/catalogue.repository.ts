import {
  Product,
  PrintOption,
  ProductListQuery,
  PaginatedResult,
} from "./catalogue.types";
import { sampleProducts, samplePrintOptions } from "./catalogue.sample-data";
import { Pool } from "pg";
import { getDatabasePool } from "../../config/database";

export interface ICatalogueRepository {
  findProducts(query: ProductListQuery): Promise<PaginatedResult<Product>>;
  findProductById(id: string): Promise<Product | null>;
  findPrintOptions(productId?: string): Promise<PrintOption[]>;
}

export class InMemoryCatalogueRepository implements ICatalogueRepository {
  private products: Product[] = [...sampleProducts];
  private printOptions: PrintOption[] = [...samplePrintOptions];

  async findProducts(query: ProductListQuery): Promise<PaginatedResult<Product>> {
    let filtered = this.products.filter((product) => product.isActive);

    if (query.category) {
      filtered = filtered.filter(
        (product) => product.category.toLowerCase() === query.category?.toLowerCase()
      );
    }

    const total = filtered.length;
    const startIndex = (query.page - 1) * query.pageSize;
    return {
      data: filtered.slice(startIndex, startIndex + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async findProductById(id: string): Promise<Product | null> {
    return (
      this.products.find((product) => product.id === id || product.slug === id) ??
      null
    );
  }

  async findPrintOptions(productId?: string): Promise<PrintOption[]> {
    return productId
      ? this.printOptions.filter((option) => option.productId === productId)
      : [...this.printOptions];
  }
}

export class PostgresCatalogueRepository implements ICatalogueRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async findProducts(query: ProductListQuery): Promise<PaginatedResult<Product>> {
    const filters = query.category ? "AND lower(category) = lower($1)" : "";
    const filterValues = query.category ? [query.category] : [];
    const offsetIndex = filterValues.length + 1;
    const limitIndex = filterValues.length + 2;
    const paginationValues = [
      ...filterValues,
      (query.page - 1) * query.pageSize,
      query.pageSize,
    ];
    const [count, result] = await Promise.all([
      this.pool.query(
        `SELECT count(*)::int AS total FROM products WHERE is_active = true ${filters}`,
        filterValues
      ),
      this.pool.query(
        `SELECT id, slug, name, description, category, is_active, min_quantity,
          max_quantity, starting_price, currency, is_sample
         FROM products WHERE is_active = true ${filters}
         ORDER BY name LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        paginationValues
      ),
    ]);

    return {
      data: result.rows.map(mapProduct),
      page: query.page,
      pageSize: query.pageSize,
      total: count.rows[0].total,
    };
  }

  async findProductById(id: string): Promise<Product | null> {
    const result = await this.pool.query(
      `SELECT id, slug, name, description, category, is_active, min_quantity,
        max_quantity, starting_price, currency, is_sample
       FROM products WHERE id = $1 OR slug = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
  }

  async findPrintOptions(productId?: string): Promise<PrintOption[]> {
    const result = await this.pool.query(
      `SELECT id, product_id, code, name, type, choices
       FROM print_options ${productId ? "WHERE product_id = $1" : ""}
       ORDER BY product_id, code`,
      productId ? [productId] : []
    );
    return result.rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      code: row.code,
      name: row.name,
      type: row.type,
      choices: row.choices,
    }));
  }
}

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description),
    category: String(row.category) as Product["category"],
    isActive: Boolean(row.is_active),
    minQuantity: Number(row.min_quantity),
    maxQuantity: Number(row.max_quantity),
    sampleStartingPrice: Number(row.starting_price),
    currency: String(row.currency),
    isSample: Boolean(row.is_sample),
  };
}
