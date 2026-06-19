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

// Shoe/sneaker mapping — Athletic Shoes (15709) and similar shoe categories
// only accept: NEW_WITH_BOX, NEW_WITHOUT_BOX, NEW_WITH_DEFECTS, PRE_OWNED.
// PRE_OWNED_EXCELLENT / PRE_OWNED_FAIR are NOT accepted here (they belong to
// collectibles categories) — sending them results in errorId 25059.
const SHOE_MAP: Record<string, string> = {
  new: "NEW_WITH_BOX",
  like_new: "NEW_WITHOUT_BOX",
  very_good: "PRE_OWNED",
  good: "PRE_OWNED",
  acceptable: "PRE_OWNED",
  for_parts: "PRE_OWNED",
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
