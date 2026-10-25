import { randomUUID } from "node:crypto";
import {
  FileMetadataRecord,
  InitiateUploadInput,
  InitiateUploadResult,
} from "./upload.types";
import {
  UnprocessableEntityError,
  NotFoundError,
  PayloadTooLargeError,
} from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/tiff",
  "image/png",
  "image/jpeg",
];

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250MB

export interface IUploadService {
  initiateUpload(input: InitiateUploadInput): Promise<InitiateUploadResult>;
  getFileMetadata(fileId: string): Promise<FileMetadataRecord | null>;
}

export interface IProductionUploadService extends IUploadService {
  initiateUploadForCustomer(
    input: InitiateUploadInput,
    customerId: string
  ): Promise<InitiateUploadResult>;
  completeUpload(fileId: string, customerId: string): Promise<FileMetadataRecord>;
  createReadUrl(fileId: string, customerId: string): Promise<string>;
}

export class StubbedUploadService implements IUploadService {
  private files = new Map<string, FileMetadataRecord>();

  async initiateUpload(input: InitiateUploadInput): Promise<InitiateUploadResult> {
    if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
      throw new UnprocessableEntityError(
        `MIME type '${input.mimeType}' is not supported for print artwork. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
        ErrorCodes.VALIDATION_FAILED,
        [{ path: "mimeType", issue: `Must be one of ${ALLOWED_MIME_TYPES.join(", ")}` }]
      );
    }

    if (input.sizeBytes > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeError(
        `File size (${input.sizeBytes} bytes) exceeds maximum allowable limit of ${MAX_UPLOAD_BYTES} bytes (250MB).`
      );
    }

    // Sanitize filename to prevent directory traversal or injection
    const sanitizedFilename = input.originalFilename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 255);

    const fileId = randomUUID();
    const serverStorageKey = `artwork/${randomUUID()}`; // Private key never exposed to client

    const record: FileMetadataRecord = {
      id: fileId,
      storageKey: serverStorageKey,
      originalName: sanitizedFilename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "pending",
      quoteId: input.quoteId,
      orderId: input.orderId,
      createdAt: new Date().toISOString(),
    };

    this.files.set(fileId, record);

    return {
      fileId,
      uploadUrl: `https://storage.demo.local/upload-stub/${fileId}?key=DEMO_ONLY_STUB`,
      status: "pending",
      maxBytes: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      isDemo: true,
    };
  }

  async getFileMetadata(fileId: string): Promise<FileMetadataRecord | null> {
    const record = this.files.get(fileId);
    return record ? { ...record } : null;
  }
}
