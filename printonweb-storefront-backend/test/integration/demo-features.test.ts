import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app";
import { StubbedUploadService } from "../../src/modules/uploads/upload.service";

describe("Demo Features (Uploads & Payments) - Integration Tests", () => {
  const uploadService = new StubbedUploadService();
  const app = createApp({ uploadService });

  describe("Artwork Upload Metadata Stub - POST /api/demo/uploads", () => {
    it("accepts valid artwork metadata and returns server-generated key and demo URL", async () => {
      const res = await request(app)
        .post("/api/demo/uploads")
        .send({
          originalFilename: "my-flyer-artwork.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1048576, // 1MB
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("fileId");
      expect(res.body).toHaveProperty("uploadUrl");
      expect(res.body).toHaveProperty("status", "pending");
      expect(res.body).toHaveProperty("isDemo", true);

      // Verify server storage key is internal and never client-supplied
      const metadata = await uploadService.getFileMetadata(res.body.fileId);
      expect(metadata?.storageKey).toMatch(/^artwork\/[a-f0-9-]+$/);
      expect(metadata?.originalName).toBe("my-flyer-artwork.pdf");
    });

    it("rejects disallowed MIME types with 422", async () => {
      const res = await request(app)
        .post("/api/demo/uploads")
        .send({
          originalFilename: "malicious.exe",
          mimeType: "application/x-msdownload",
          sizeBytes: 5000,
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toHaveProperty("code", "VALIDATION_FAILED");
      expect(res.body.error.message).toContain("not supported for print artwork");
    });

    it("rejects files exceeding maximum upload limit with 413", async () => {
      const res = await request(app)
        .post("/api/demo/uploads")
        .send({
          originalFilename: "huge-poster.pdf",
          mimeType: "application/pdf",
          sizeBytes: 300 * 1024 * 1024, // 300MB (exceeds 250MB limit)
        });

      expect(res.status).toBe(413);
      expect(res.body.error).toHaveProperty("code", "PAYLOAD_TOO_LARGE");
    });
  });

  describe("Demo Checkout Stub - POST /api/demo/checkout", () => {
    it("returns explicit demo success with zero charges and demo label", async () => {
      const res = await request(app)
        .post("/api/demo/checkout")
        .send({
          orderId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          paymentMethod: "demo_upi",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status", "DEMO_SUCCESS");
      expect(res.body).toHaveProperty("amountCharged", 0);
      expect(res.body).toHaveProperty("isDemo", true);
      expect(res.body.message).toContain("DEMO ONLY: No real payment was initiated");
    });
  });
});
