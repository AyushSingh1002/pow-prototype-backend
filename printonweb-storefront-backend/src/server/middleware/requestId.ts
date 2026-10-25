import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers["x-request-id"];
  const requestId = typeof incomingId === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(incomingId)
    ? incomingId
    : `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  req.id = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}
