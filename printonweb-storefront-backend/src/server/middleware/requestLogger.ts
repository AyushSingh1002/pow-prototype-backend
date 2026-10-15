import { Request, Response, NextFunction } from "express";

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const logRecord = {
      timestamp: new Date().toISOString(),
      requestId: req.id,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    };

    // Output single line JSON in production/test, or readable JSON in dev
    if (process.env.NODE_ENV !== "test") {
      console.log(JSON.stringify(logRecord));
    }
  });

  next();
}
