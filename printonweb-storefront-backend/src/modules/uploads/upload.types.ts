export type FileStatus = "pending" | "uploaded" | "scanned" | "rejected";

export interface FileMetadataRecord {
  id: string; // Public identifier (UUID)
  storageKey: string; // Server-generated key, never exposed directly to clients
  originalName: string; // Sanitized display name only
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  quoteId?: string;
  orderId?: string;
  createdAt: string;
}

export interface InitiateUploadInput {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  quoteId?: string;
  orderId?: string;
}

export interface InitiateUploadResult {
  fileId: string;
  uploadUrl: string; // Demo pre-signed URL stub
  status: FileStatus;
  maxBytes: number;
  allowedMimeTypes: string[];
  isDemo: true;
}
