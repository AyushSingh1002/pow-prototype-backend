import { describe, expect, it } from "vitest";
import { getRequiredArtworkSlots } from "../../src/modules/orders/artwork-requirements";

describe("production artwork requirements", () => {
  it("requires the interior file for books", () => {
    expect(getRequiredArtworkSlots("books", {})).toEqual(["interior"]);
  });

  it("requires a reverse side for double-sided business cards", () => {
    expect(getRequiredArtworkSlots("business-cards", { sides: "double" })).toEqual([
      "primary",
      "back",
    ]);
  });

  it("requires the second panel for folded brochures", () => {
    expect(getRequiredArtworkSlots("flyers-brochures", { fold: "tri-fold" })).toEqual([
      "primary",
      "back",
    ]);
  });

  it("requires both spreads and cover artwork for photo albums", () => {
    expect(getRequiredArtworkSlots("photo-albums", {})).toEqual(["primary", "cover"]);
  });

  it("fails closed for an unknown product workflow", () => {
    expect(() => getRequiredArtworkSlots("unconfigured-product", {})).toThrow(
      /Production artwork requirements are not configured/
    );
  });
});
