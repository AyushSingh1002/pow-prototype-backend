import { Request, Response, NextFunction } from "express";
import {
  UnauthorizedError,
  ForbiddenError,
  ServiceUnavailableError,
} from "../../core/errors/AppError";
import { env } from "../../config/env";
import { OrderService } from "../../modules/orders/order.service";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
      staff?: {
        id: string;
        displayName: string;
        role: "staff" | "admin";
      };
    }
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return next(new UnauthorizedError("Authentication token is missing."));
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return next(new UnauthorizedError("Malformed Authorization header. Format: Bearer <token>."));
  }

  if (env.ENABLE_DEMO_MODE && token === "blocked-token") {
    return next(new ForbiddenError("Customer account is blocked from placing orders."));
  }

  if (env.ENABLE_DEMO_MODE || env.NODE_ENV === "test") {
    const demoCustomerIds = new Set(["cust_author_42", "cust_business_07"]);
    if (token === "demo-token" || demoCustomerIds.has(token)) {
      req.user = {
        id: token === "demo-token" ? "cust_demo_1" : token,
        role: "customer",
      };
      return next();
    }
    return next(new UnauthorizedError("Invalid or expired demo authentication token."));
  }

  try {
    req.user = {
      id: await resolveSupabaseIdentity(token, {
        url: env.SUPABASE_URL,
        anonKey: env.SUPABASE_ANON_KEY,
      }),
      role: "customer",
    };
    return next();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ServiceUnavailableError) {
      return next(error);
    }
    console.error("Authentication provider request failed.");
    return next(new ServiceUnavailableError("Authentication provider is unavailable."));
  }
}

export async function resolveSupabaseIdentity(
  token: string,
  config: { url?: string; anonKey?: string }
): Promise<string> {
  return (await resolveSupabaseUser(token, config)).id;
}

export async function resolveSupabaseUser(
  token: string,
  config: { url?: string; anonKey?: string }
): Promise<{ id: string; role?: string }> {
  if (!config.url || !config.anonKey) {
    throw new ServiceUnavailableError("Authentication provider is not configured.");
  }

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ServiceUnavailableError("Authentication provider is unavailable.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedError("Invalid or expired authentication token.");
  }
  if (!response.ok) {
    throw new ServiceUnavailableError(
      "Authentication provider could not verify the session."
    );
  }

  const user: unknown = await response.json();
  if (
    !user ||
    typeof user !== "object" ||
    !("id" in user) ||
    typeof user.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      user.id
    )
  ) {
    throw new UnauthorizedError(
      "Authentication provider returned an invalid user identity."
    );
  }

  const role =
    "app_metadata" in user &&
    user.app_metadata &&
    typeof user.app_metadata === "object" &&
    "role" in user.app_metadata &&
    typeof user.app_metadata.role === "string"
      ? user.app_metadata.role
      : undefined;
  return { id: user.id, role };
}

export function requireStaffAuth(orderService: OrderService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return next(new UnauthorizedError("Authentication token is missing."));
    const [scheme, token] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token) {
      return next(new UnauthorizedError("Malformed Authorization header. Format: ******"));
    }

    if (env.ENABLE_DEMO_MODE || env.NODE_ENV === "test") {
      if (token !== "demo-staff-token" && token !== "staff_demo_1") {
        return next(new UnauthorizedError("A staff login is required."));
      }
      req.staff = { id: "staff_demo_1", displayName: "Demo Staff", role: "staff" };
      return next();
    }

    try {
      const identity = await resolveSupabaseUser(token, {
        url: env.SUPABASE_URL,
        anonKey: env.SUPABASE_ANON_KEY,
      });
      if (identity.role !== "staff" && identity.role !== "admin") {
        return next(new ForbiddenError("A staff account is required."));
      }
      const staff = await orderService.findStaffAccount(identity.id);
      if (!staff || staff.role !== identity.role) {
        return next(new ForbiddenError("The authenticated user is not an active staff account."));
      }
      req.user = { id: identity.id, role: identity.role };
      req.staff = {
        id: staff.id,
        displayName: staff.displayName,
        role: staff.role,
      };
      return next();
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof ServiceUnavailableError) {
        return next(error);
      }
      console.error("Staff authentication provider request failed.");
      return next(new ServiceUnavailableError("Staff authentication is unavailable."));
    }
  };
}
