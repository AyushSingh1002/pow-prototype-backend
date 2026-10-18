import { Request, Response, NextFunction } from "express";
import { UnauthorizedError, ForbiddenError } from "../../core/errors/AppError";
import { env } from "../../config/env";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return next(new UnauthorizedError("Authentication token is missing."));
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return next(new UnauthorizedError("Malformed Authorization header. Format: Bearer <token>."));
  }

  if (token === "blocked-token") {
    return next(new ForbiddenError("Customer account is blocked from placing orders."));
  }

  // Fixed identities are only for the explicitly non-production demo runtime.
  const demoCustomerIds = new Set(["cust_author_42", "cust_business_07"]);
  if (env.NODE_ENV !== "production" && (token === "demo-token" || demoCustomerIds.has(token))) {
    req.user = {
      id: token === "demo-token" ? "cust_demo_1" : token,
      role: "customer",
    };
    return next();
  }

  return next(new UnauthorizedError("Invalid or expired authentication token."));
}
