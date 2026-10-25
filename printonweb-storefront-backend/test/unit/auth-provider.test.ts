import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveSupabaseIdentity,
} from "../../src/server/middleware/auth";
import {
  ServiceUnavailableError,
  UnauthorizedError,
} from "../../src/core/errors/AppError";

describe("Supabase identity verification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves the customer id only from a verified provider response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "4f7a8d30-12e1-4bc0-8d23-b2a533ac90ef" }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveSupabaseIdentity("verified-access-token", {
        url: "https://auth.example.test",
        anonKey: "public-anon-key",
      })
    ).resolves.toBe("4f7a8d30-12e1-4bc0-8d23-b2a533ac90ef");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.example.test/auth/v1/user",
      expect.objectContaining({
        headers: {
          apikey: "public-anon-key",
          Authorization: "Bearer verified-access-token",
        },
      })
    );
  });

  it("rejects invalid or expired provider tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    );

    await expect(
      resolveSupabaseIdentity("expired-token", {
        url: "https://auth.example.test",
        anonKey: "public-anon-key",
      })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("fails closed when provider configuration or availability is missing", async () => {
    await expect(
      resolveSupabaseIdentity("token", { url: "https://auth.example.test" })
    ).rejects.toBeInstanceOf(ServiceUnavailableError);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));
    await expect(
      resolveSupabaseIdentity("token", {
        url: "https://auth.example.test",
        anonKey: "public-anon-key",
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
