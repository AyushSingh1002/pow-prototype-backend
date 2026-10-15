import { Request, Response, NextFunction } from "express";
import { RateLimitedError } from "../../core/errors/AppError";

interface RateLimitEntry {
  timestamps: number[];
}

export class InMemoryRateLimiter {
  private hits = new Map<string, RateLimitEntry>();

  constructor(
    private readonly windowMs: number = 60000,
    private readonly maxRequests: number = 30
  ) {}

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const key = req.ip || req.socket.remoteAddress || "global";
      const now = Date.now();

      let entry = this.hits.get(key);
      if (!entry) {
        entry = { timestamps: [] };
        this.hits.set(key, entry);
      }

      // Filter out timestamps outside window
      const windowStart = now - this.windowMs;
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

      if (entry.timestamps.length >= this.maxRequests) {
        return next(
          new RateLimitedError(
            `Rate limit exceeded. Maximum ${this.maxRequests} requests per ${this.windowMs / 1000}s allowed.`
          )
        );
      }

      entry.timestamps.push(now);
      next();
    };
  }

  reset(): void {
    this.hits.clear();
  }
}
