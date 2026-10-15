import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { ValidationError, ErrorDetail } from "../../core/errors/AppError";

interface RequestValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
  headers?: ZodSchema;
}

export function validateRequest(schemas: RequestValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.headers) {
        req.headers = schemas.headers.parse(req.headers);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details: ErrorDetail[] = err.issues.map((issue) => {
          let path = issue.path.join(".");
          if (!path && "keys" in issue && Array.isArray((issue as any).keys)) {
            path = (issue as any).keys.join(", ");
          }
          return {
            path: path || "root",
            issue: issue.message,
          };
        });
        return next(new ValidationError("One or more fields are invalid.", details));
      }
      next(err);
    }
  };
}
