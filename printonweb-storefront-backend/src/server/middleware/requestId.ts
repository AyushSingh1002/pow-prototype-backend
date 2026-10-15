import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers["x-request-id"];
  const requestId = typeof incomingId === "string" && incomingId.length > 0
    ? incomingId
    : `req_${uuidv4().replace(/-/g, "").slice(0, 16)}`;

  req.id = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}
