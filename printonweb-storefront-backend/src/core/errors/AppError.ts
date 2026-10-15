import { ErrorCode, ErrorCodes } from "./errorCodes";

export interface ErrorDetail {
  path: string;
  issue: string;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: ErrorDetail[];

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: ErrorDetail[]
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "One or more fields are invalid.", details?: ErrorDetail[]) {
    super(400, ErrorCodes.VALIDATION_FAILED, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCodes.PRODUCT_NOT_FOUND) {
    super(404, code, message);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCodes.INCOMPATIBLE_OPTIONS, details?: ErrorDetail[]) {
    super(422, code, message, details);
  }
}

export class RateLimitedError extends AppError {
  constructor(message: string = "Too many requests. Please try again later.") {
    super(429, ErrorCodes.RATE_LIMITED, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string = "Request entity too large.") {
    super(413, ErrorCodes.PAYLOAD_TOO_LARGE, message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message: string = "Unsupported content type. Expected application/json.") {
    super(415, ErrorCodes.UNSUPPORTED_MEDIA_TYPE, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCodes.DUPLICATE_IDEMPOTENCY_KEY) {
    super(409, code, message);
  }
}

export class GoneError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCodes.QUOTE_EXPIRED) {
    super(410, code, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Authentication required.") {
    super(401, ErrorCodes.UNAUTHORIZED, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Access denied.") {
    super(403, ErrorCodes.FORBIDDEN, message);
  }
}
