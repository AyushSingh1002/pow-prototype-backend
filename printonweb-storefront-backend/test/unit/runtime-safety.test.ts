import { describe, expect, it } from "vitest";
import { assertDemoRuntimeAllowed } from "../../src/server/app";

describe("runtime safety", () => {
  it("allows the explicitly non-production demo runtime", () => {
    expect(() => assertDemoRuntimeAllowed("development")).not.toThrow();
    expect(() => assertDemoRuntimeAllowed("test")).not.toThrow();
  });

  it("refuses production while demo services are wired", () => {
    expect(() => assertDemoRuntimeAllowed("production")).toThrow(
      /Production startup is disabled/
    );
  });
});
