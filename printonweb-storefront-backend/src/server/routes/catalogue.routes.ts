import { Router, Request, Response, NextFunction } from "express";
import { CatalogueService } from "../../modules/catalogue/catalogue.service";
import { validateRequest } from "../middleware/validate";
import {
  listProductsQuerySchema,
  printOptionsQuerySchema,
} from "../schemas/catalogue.schemas";

export function createCatalogueRouter(catalogueService: CatalogueService): Router {
  const router = Router();

  // GET /api/products
  router.get(
    "/products",
    validateRequest({ query: listProductsQuerySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const query = req.query as unknown as {
          page: number;
          pageSize: number;
          category?: string;
        };
        const result = await catalogueService.listProducts(query);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/print-options
  router.get(
    "/print-options",
    validateRequest({ query: printOptionsQuerySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const query = req.query as unknown as { productId?: string };
        const data = await catalogueService.getPrintOptions(query.productId);
        res.status(200).json({ data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
