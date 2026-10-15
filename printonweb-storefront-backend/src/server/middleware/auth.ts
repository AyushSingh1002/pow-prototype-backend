import { Request, Response, NextFunction } from "express";
import { UnauthorizedError, ForbiddenError } from "../../core/errors/AppError";

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

  // Simulated authenticated user context for demo / test suites
  if (token === "demo-token" || token.startsWith("cust_")) {
    req.user = {
      id: token.startsWith("cust_") ? token : "cust_demo_1",
      role: "customer",
    };
    return next();
  }

  return next(new UnauthorizedError("Invalid or expired authentication token."));
}
