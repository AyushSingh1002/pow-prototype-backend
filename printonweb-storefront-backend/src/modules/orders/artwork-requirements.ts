import { UnprocessableEntityError } from "../../core/errors/AppError";

export function getRequiredArtworkSlots(
  productId: string,
  options: Record<string, unknown>
): string[] {
  switch (productId) {
    case "books":
    case "notebooks":
      return ["interior"];
    case "certificates":
    case "posters":
    case "letterheads":
    case "custom-stickers":
    case "documents":
    case "calendars":
      return ["primary"];
    case "business-cards":
      return options.sides === "double" ? ["primary", "back"] : ["primary"];
    case "flyers-brochures":
      return options.sides === "double" ||
        options.fold === "bi-fold" ||
        options.fold === "tri-fold"
        ? ["primary", "back"]
        : ["primary"];
    case "photo-albums":
      return ["primary", "cover"];
    default:
      throw new UnprocessableEntityError(
        `Production artwork requirements are not configured for '${productId}'.`
      );
  }
}
