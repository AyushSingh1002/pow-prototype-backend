import { describe, expect, it } from "vitest";
import { assertDemoRuntimeAllowed } from "../../src/server/app";

describe("runtime safety", () => {
  it("allows the explicitly non-production demo runtime", () => {
    expect(() => assertDemoRuntimeAllowed("development")).not.toThrow();
    expect(() => assertDemoRuntimeAllowed("test")).not.toThrow();
  });

  it("allows production when no demo services are wired", () => {
    expect(() => assertDemoRuntimeAllowed("production", { demoServices: [] })).not.toThrow();
  });

  it("refuses production while demo services are wired", () => {
    expect(() => assertDemoRuntimeAllowed("production", { demoServices: ["Demo payments"] })).toThrow(
      /Production startup is disabled: demo services are configured/
    );
  });

  it("refuses production if demo mode is explicitly enabled", () => {
    expect(() =>
      assertDemoRuntimeAllowed("production", {
        enableDemoMode: true,
      })
    ).toThrow(/ENABLE_DEMO_MODE must be false/);
  });
});
