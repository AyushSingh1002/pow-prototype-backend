export interface ProductOptionChoice {
  value: string;
  label: string;
  description?: string;
}

export interface PrintOption {
  id: string;
  productId: string;
  code: string;
  name: string;
  type: "size" | "stock" | "finish" | "sides" | "fold" | "material" | "cut" | "binding" | "interior" | "pages";
  choices: ProductOptionChoice[];
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: "stationery" | "marketing" | "packaging" | "labels" | "books" | "documents";
  description: string;
  isActive: boolean;
  minQuantity: number;
  maxQuantity: number;
  sampleStartingPrice: number; // In minor units (paise)
  currency: string;
  isSample: true;
}

export interface ProductListQuery {
  page: number;
  pageSize: number;
  category?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
