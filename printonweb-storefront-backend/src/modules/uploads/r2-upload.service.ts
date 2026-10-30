import { randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Pool } from "pg";
import { env } from "../../config/env";
import {
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  UnprocessableEntityError,
} from "../../core/errors/AppError";
import { ErrorCodes } from "../../core/errors/errorCodes";
import {
  ALLOWED_MIME_TYPES,
  IProductionUploadService,
  MAX_UPLOAD_BYTES,
} from "./upload.service";
import {
  FileMetadataRecord,
  InitiateUploadInput,
  InitiateUploadResult,
} from "./upload.types";
import { getDatabasePool } from "../../config/database";

interface ScanResult {
  clean: boolean;
}

interface PreflightResult {
  passed: boolean;
  pageCount: number;
  minimumDpi: number;
  bleedVerified: boolean;
}

export class R2UploadService implements IProductionUploadService {
  private readonly storage: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly options = {
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      bucket: env.STORAGE_BUCKET,
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      scanUrl: env.FILE_SCAN_URL,
      scanToken: env.FILE_SCAN_TOKEN,
      preflightUrl: env.PREFLIGHT_SERVICE_URL,
      preflightToken: env.PREFLIGHT_SERVICE_TOKEN,
      minDpi: Number(env.MIN_PRINT_DPI),
    }
  ) {
    const { endpoint, region, bucket, accessKeyId, secretAccessKey } = options;
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("R2 storage configuration is incomplete.");
    }
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.pathname.replace(/^\/+|\/+$/g, "") === bucket) {
      endpointUrl.pathname = "/";
    }
    this.bucket = bucket;
    this.storage = new S3Client({
      region,
      endpoint: endpointUrl.toString(),
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async initiateUpload(input: InitiateUploadInput): Promise<InitiateUploadResult> {
    throw new UnprocessableEntityError("Authenticated customer identity is required for uploads.");
  }

  async initiateUploadForCustomer(
    input: InitiateUploadInput,
    customerId: string
  ): Promise<InitiateUploadResult> {
    validateUploadInput(input);
    const id = randomUUID();
    const key = `${customerId}/${randomUUID()}`;
    const uploadKey = `${customerId}/incoming/${randomUUID()}`;
    const safeFilename = sanitizeFilename(input.originalFilename);
    const retentionDays = Number(env.ARTWORK_RETENTION_DAYS ?? 30);
    if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
      throw new Error("ARTWORK_RETENTION_DAYS must be a positive integer.");
    }
    const retentionExpiresAt = new Date(
      Date.now() + retentionDays * 24 * 60 * 60 * 1000
    );
    await this.pool.query(
      `INSERT INTO files (
        id, customer_id, storage_key, upload_key, original_name, mime_type, slot_id, size_bytes,
        status, quote_id, order_id, retention_expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10,
        $11)`,
      [
        id,
        customerId,
        key,
        uploadKey,
        safeFilename,
        input.mimeType,
        input.slotId,
        input.sizeBytes,
        input.quoteId ?? null,
        input.orderId ?? null,
        retentionExpiresAt,
      ]
    );

    const uploadUrl = await getSignedUrl(
      this.storage,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: uploadKey,
        ContentType: input.mimeType,
        Metadata: { "file-id": id },
      }),
      { expiresIn: 300 }
    );
    return {
      fileId: id,
      uploadUrl,
      status: "pending",
      maxBytes: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      isDemo: false,
    };
  }

  async completeUpload(fileId: string, customerId: string): Promise<FileMetadataRecord> {
    const record = await this.findOwnedFile(fileId, customerId);
    if (record.status === "scanned") return record;

    try {
      const uploadKey = record.uploadKey;
      if (!uploadKey) {
        throw new ServiceUnavailableError("Temporary artwork object key is missing.");
      }
      const head = await this.storage.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: uploadKey })
      );
      if (head.ContentLength !== record.sizeBytes) {
        throw new UnprocessableEntityError("Uploaded object size does not match the declared size.");
      }
      if (head.ContentLength === undefined || head.ContentLength <= 0 || head.ContentLength > MAX_UPLOAD_BYTES) {
        throw new PayloadTooLargeError("Uploaded object has an invalid or excessive size.");
      }
      if (!head.ETag) {
        throw new ServiceUnavailableError("Uploaded object did not include a verifiable entity tag.");
      }

      const object = await this.storage.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: uploadKey,
          Range: "bytes=0-4095",
        })
      );
      if (!object.Body) {
        throw new ServiceUnavailableError("Uploaded object content could not be read.");
      }
      const prefix = Buffer.from(await object.Body.transformToByteArray());
      validateMagicBytes(record.mimeType, prefix);

      await this.updateFileStatus(fileId, "uploaded");
      const readUrl = await this.createSignedReadUrl(uploadKey);
      const scan = await this.postProcessor<ScanResult>(
        this.options.scanUrl,
        this.options.scanToken,
        { fileId, downloadUrl: readUrl, mimeType: record.mimeType, sizeBytes: record.sizeBytes }
      );
      if (scan.clean !== true) {
        throw new UnprocessableEntityError("Artwork failed malware scanning and was rejected.");
      }

      const preflight = await this.postProcessor<PreflightResult>(
        this.options.preflightUrl,
        this.options.preflightToken,
        { fileId, downloadUrl: readUrl, mimeType: record.mimeType }
      );
      if (
        preflight.passed !== true ||
        !Number.isSafeInteger(preflight.pageCount) ||
        preflight.pageCount < 1 ||
        !Number.isFinite(preflight.minimumDpi) ||
        preflight.minimumDpi < this.options.minDpi ||
        preflight.bleedVerified !== true
      ) {
        throw new UnprocessableEntityError(
          "Artwork failed server-side page, resolution, or bleed preflight."
        );
      }

      const latestHead = await this.storage.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: uploadKey })
      );
      if (latestHead.ETag !== head.ETag) {
        throw new UnprocessableEntityError(
          "Artwork changed while server-side scanning and preflight were running."
        );
      }
      const encodedCopySource = `${this.bucket}/${uploadKey
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
      await this.storage.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: record.storageKey,
          CopySource: encodedCopySource,
          CopySourceIfMatch: head.ETag,
          MetadataDirective: "COPY",
        })
      );
      await this.storage.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: uploadKey })
      );
      await this.updateFileStatus(fileId, "scanned", preflight);
      return { ...record, uploadKey: undefined, status: "scanned", preflight };
    } catch (error) {
      await this.updateFileStatus(fileId, "rejected");
      throw error;
    }
  }

  async getFileMetadata(fileId: string): Promise<FileMetadataRecord | null> {
    const result = await this.pool.query(
      `SELECT id, customer_id, storage_key, upload_key, original_name, mime_type, slot_id, size_bytes,
        status, quote_id, order_id, page_count, minimum_dpi, bleed_verified, created_at
       FROM files WHERE id = $1`,
      [fileId]
    );
    return result.rows[0] ? mapFile(result.rows[0]) : null;
  }

  async createReadUrl(fileId: string, customerId: string): Promise<string> {
    const file = await this.findOwnedFile(fileId, customerId);
    if (file.status !== "scanned") {
      throw new UnprocessableEntityError("Only scanned artwork can be downloaded.");
    }
    return this.createSignedReadUrl(file.storageKey);
  }

  async deleteOrderArtwork(orderId: string): Promise<number> {
    const result = await this.pool.query(
      "SELECT id, storage_key, upload_key FROM files WHERE order_id = $1 ORDER BY id",
      [orderId]
    );
    let deleted = 0;
    for (const file of result.rows) {
      const storageKey = String(file.storage_key);
      const uploadKey = file.upload_key ? String(file.upload_key) : undefined;
      await this.storage.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey })
      );
      if (uploadKey && uploadKey !== storageKey) {
        await this.storage.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: uploadKey })
        );
      }
      const removed = await this.pool.query(
        "DELETE FROM files WHERE id = $1 AND order_id = $2",
        [file.id, orderId]
      );
      deleted += removed.rowCount ?? 0;
    }
    return deleted;
  }

  async deleteExpiredFiles(limit = 100): Promise<number> {
    const result = await this.pool.query(
      `SELECT id, storage_key, upload_key FROM files
       WHERE retention_expires_at <= now()
       ORDER BY retention_expires_at, id
       LIMIT $1`,
      [limit]
    );
    let deleted = 0;
    for (const file of result.rows) {
      const storageKey = String(file.storage_key);
      const uploadKey = file.upload_key ? String(file.upload_key) : undefined;
      await this.storage.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey })
      );
      if (uploadKey && uploadKey !== storageKey) {
        await this.storage.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: uploadKey })
        );
      }
      const removed = await this.pool.query(
        "DELETE FROM files WHERE id = $1 AND retention_expires_at <= now()",
        [file.id]
      );
      deleted += removed.rowCount ?? 0;
    }
    return deleted;
  }

  private async findOwnedFile(fileId: string, customerId: string): Promise<FileMetadataRecord> {
    const result = await this.pool.query(
      `SELECT id, customer_id, storage_key, upload_key, original_name, mime_type, slot_id, size_bytes,
        status, quote_id, order_id, page_count, minimum_dpi, bleed_verified, created_at
       FROM files WHERE id = $1 AND customer_id = $2`,
      [fileId, customerId]
    );
    if (!result.rows[0]) {
      throw new NotFoundError("Artwork file not found.", ErrorCodes.ORDER_NOT_FOUND);
    }
    return mapFile(result.rows[0]);
  }

  private async createSignedReadUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.storage,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 300 }
    );
  }

  private async postProcessor<T>(
    endpoint: string | undefined,
    token: string | undefined,
    data: Record<string, unknown>
  ): Promise<T> {
    if (!endpoint || !token) {
      throw new ServiceUnavailableError("File scanning and preflight services must be configured.");
    }
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ServiceUnavailableError("File scanning or preflight service is unavailable.");
    }
    if (!response.ok) {
      throw new ServiceUnavailableError("File scanning or preflight service returned an error.");
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableError("File processing service returned invalid JSON.");
    }
  }

  private async updateFileStatus(
    fileId: string,
    status: string,
    preflight?: PreflightResult
  ): Promise<void> {
    await this.pool.query(
      `UPDATE files SET status = $2, page_count = $3, minimum_dpi = $4,
       bleed_verified = $5 WHERE id = $1`,
      [
        fileId,
        status,
        preflight?.pageCount ?? null,
        preflight?.minimumDpi ?? null,
        preflight?.bleedVerified ?? false,
      ]
    );
  }
}

function validateUploadInput(input: InitiateUploadInput): void {
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    throw new UnprocessableEntityError("Artwork MIME type is not supported.", ErrorCodes.VALIDATION_FAILED);
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError("Artwork exceeds the maximum upload size.");
  }
  if (!input.originalFilename.trim() || input.originalFilename.length > 255) {
    throw new UnprocessableEntityError("Artwork filename is invalid.", ErrorCodes.VALIDATION_FAILED);
  }
  if (!input.slotId) {
    throw new UnprocessableEntityError("Artwork slot is required.", ErrorCodes.VALIDATION_FAILED);
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 255);
}

export function validateMagicBytes(mimeType: string, bytes: Buffer): void {
  const isPdf =
    mimeType === "application/pdf" &&
    bytes.subarray(0, Math.min(bytes.length, 1024)).includes(Buffer.from("%PDF-"));
  const isPng =
    mimeType === "image/png" &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg =
    mimeType === "image/jpeg" &&
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isTiff =
    mimeType === "image/tiff" &&
    (bytes.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])));
  if (!isPdf && !isPng && !isJpeg && !isTiff) {
    throw new UnprocessableEntityError(
      "Uploaded content does not match the declared artwork file type.",
      ErrorCodes.VALIDATION_FAILED
    );
  }
}

function mapFile(row: Record<string, unknown>): FileMetadataRecord {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    storageKey: String(row.storage_key),
    uploadKey: row.upload_key ? String(row.upload_key) : undefined,
    originalName: String(row.original_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    slotId: String(row.slot_id),
    status: row.status as FileMetadataRecord["status"],
    quoteId: row.quote_id ? String(row.quote_id) : undefined,
    orderId: row.order_id ? String(row.order_id) : undefined,
    createdAt: new Date(row.created_at as Date | string).toISOString(),
    preflight:
      row.page_count !== null && row.page_count !== undefined
        ? {
            pageCount: Number(row.page_count),
            minimumDpi: Number(row.minimum_dpi),
            bleedVerified: Boolean(row.bleed_verified),
          }
        : undefined,
  };
}
