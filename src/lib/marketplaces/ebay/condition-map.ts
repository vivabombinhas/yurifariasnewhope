/**
 * eBay condition mapping — category aware.
 *
 * eBay validates ConditionEnum per category (errorId 25059 when invalid).
 * Most categories accept the generic USED_* enums. Shoes/sneakers and a
 * handful of fashion categories require the "boxed/pre-owned" enums.
 */

// Default mapping — generic categories (electronics, books, home, etc.)
const DEFAULT_MAP: Record<string, string> = {
  new: "NEW",
  like_new: "LIKE_NEW",
  very_good: "USED_VERY_GOOD",
  good: "USED_GOOD",
  acceptable: "USED_ACCEPTABLE",
  for_parts: "FOR_PARTS_OR_NOT_WORKING",
};

// Shoe/sneaker style mapping — categories that require NEW_WITH_BOX / PRE_OWNED_*
const SHOE_MAP: Record<string, string> = {
  new: "NEW_WITH_BOX",
  like_new: "PRE_OWNED_EXCELLENT",
  very_good: "PRE_OWNED_EXCELLENT",
  good: "PRE_OWNED_FAIR",
  acceptable: "PRE_OWNED_FAIR",
  // No "for_parts" equivalent — fall back to PRE_OWNED_FAIR
  for_parts: "PRE_OWNED_FAIR",
};

// Known eBay leaf categories that require the shoe-style condition enums.
// Extend as new ones are discovered. Athletic Shoes = 15709.
const SHOE_CATEGORY_IDS = new Set<string>([
  "15709", // Athletic Shoes (Men's)
  "24087", // Athletic Shoes (Women's)
  "57929", // Athletic Shoes (Unisex Kids')
  "57974", // Boys' Shoes
  "57835", // Girls' Shoes
  "53120", // Women's Shoes (varies)
  "93427", // Men's Shoes (varies)
]);

export function isShoeCategory(categoryId: string | null | undefined): boolean {
  return !!categoryId && SHOE_CATEGORY_IDS.has(String(categoryId));
}

/**
 * Map internal product_condition enum → eBay ConditionEnum,
 * choosing the variant accepted by the target category.
 * Returns undefined if the condition is unknown.
 */
export function mapEbayCondition(
  productCondition: string | null | undefined,
  categoryId: string | null | undefined,
): string | undefined {
  if (!productCondition) return undefined;
  const map = isShoeCategory(categoryId) ? SHOE_MAP : DEFAULT_MAP;
  return map[productCondition];
}
