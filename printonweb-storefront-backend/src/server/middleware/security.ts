import { Request, Response, NextFunction } from "express";
import { PayloadTooLargeError, UnsupportedMediaTypeError } from "../../core/errors/AppError";
import { env } from "../../config/env";

export function enforcePayloadLimits(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const contentLength = req.headers["content-length"];

  if (contentLength) {
    const bytes = parseInt(contentLength, 10);
    if (!isNaN(bytes) && bytes > env.MAX_BODY_BYTES) {
      return next(
        new PayloadTooLargeError(
          `Payload size of ${bytes} bytes exceeds maximum allowed limit of ${env.MAX_BODY_BYTES} bytes.`
        )
      );
    }
  }

  // Validate Content-Type for mutating write requests carrying a body
  const method = req.method.toUpperCase();
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const hasBody = contentLength ? parseInt(contentLength, 10) > 0 : false;
    const contentType = req.headers["content-type"];

    if (hasBody || contentType) {
      if (!contentType || !contentType.toLowerCase().includes("application/json")) {
        return next(
          new UnsupportedMediaTypeError(
            `Unsupported Content-Type '${contentType || "none"}'. Expected 'application/json'.`
          )
        );
      }
    }
  }

  next();
}
