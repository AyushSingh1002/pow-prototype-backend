export type FileStatus = "pending" | "uploaded" | "scanned" | "rejected";

export interface FileMetadataRecord {
  id: string; // Public identifier (UUID)
  storageKey: string; // Server-generated key, never exposed directly to clients
  uploadKey?: string;
  originalName: string; // Sanitized display name only
  mimeType: string;
  sizeBytes: number;
  slotId?: string;
  status: FileStatus;
  quoteId?: string;
  orderId?: string;
  createdAt: string;
  customerId?: string;
  preflight?: {
    pageCount: number;
    minimumDpi: number;
    bleedVerified: boolean;
  };
}

export interface InitiateUploadInput {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  slotId?: string;
  quoteId?: string;
  orderId?: string;
}

export interface InitiateUploadResult {
  fileId: string;
  uploadUrl: string; // Demo pre-signed URL stub
  status: FileStatus;
  maxBytes: number;
  allowedMimeTypes: string[];
  isDemo: boolean;
}
