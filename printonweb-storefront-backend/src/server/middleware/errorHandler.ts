import { Request, Response, NextFunction } from "express";
import { AppError } from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";

export function errorHandlerMiddleware(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const requestId = req.id || "req_unknown";

  // Handle AppError and domain subclasses
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    });
    return;
  }

  // Handle body parser syntax errors (e.g. malformed JSON in request body)
  if ("type" in err && (err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({
      error: {
        code: ErrorCodes.VALIDATION_FAILED,
        message: "Malformed JSON payload provided.",
        details: [{ path: "body", issue: "Invalid JSON syntax" }],
        requestId,
      },
    });
    return;
  }

  // Handle body parser 413 payload too large
  if ("status" in err && (err as { status?: number }).status === 413) {
    res.status(413).json({
      error: {
        code: ErrorCodes.PAYLOAD_TOO_LARGE,
        message: "Request payload size exceeds server limit.",
        requestId,
      },
    });
    return;
  }

  // Unknown internal exception: Log on server, return safe 500 without leaking stack or internal details
  if (process.env.NODE_ENV !== "test") {
    console.error(`[UnhandledError][${requestId}]`, err);
  }

  res.status(500).json({
    error: {
      code: ErrorCodes.INTERNAL_SERVER_ERROR,
      message: "An internal server error occurred.",
      requestId,
    },
  });
}
