import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app";
import { ICatalogueRepository } from "../../src/modules/catalogue/catalogue.repository";

describe("Error Handling & Response Shape - Integration Tests", () => {
  it("enforces uniform error shape on 404 unknown routes", async () => {
    const app = createApp();
    const res = await request(app).get("/api/unknown-route");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toHaveProperty("code", "NOT_FOUND");
    expect(res.body.error).toHaveProperty("message");
    expect(res.body.error).toHaveProperty("requestId");
    expect(res.body.error.requestId).toMatch(/^req_/);
  });

  it("safely handles unexpected internal exceptions with 500 without leaking stack traces or internal paths", async () => {
    // Inject a repository that deliberately throws an unhandled error
    const explodingRepo: ICatalogueRepository = {
      findProducts: async () => {
        throw new Error("DATABASE_CONNECTION_TIMEOUT: secrets in stack trace /var/secret/db.key");
      },
      findProductById: async () => null,
      findPrintOptions: async () => [],
    };

    const app = createApp({ catalogueRepository: explodingRepo as any });
    const res = await request(app).get("/api/products");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
    expect(res.body.error).toHaveProperty("message", "An internal server error occurred.");
    expect(res.body.error).toHaveProperty("requestId");

    // Must NOT leak stack trace, internal paths, or original error message to client
    expect(res.body.error).not.toHaveProperty("stack");
    expect(JSON.stringify(res.body)).not.toContain("DATABASE_CONNECTION_TIMEOUT");
    expect(JSON.stringify(res.body)).not.toContain("/var/secret");
  });
});
