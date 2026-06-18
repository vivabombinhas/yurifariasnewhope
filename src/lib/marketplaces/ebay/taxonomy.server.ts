/**
 * eBay Taxonomy API — SERVER ONLY.
 * Read-only category discovery. No InventoryItem/Offer/Publish.
 */
import { getValidEbayAccessToken } from "./token-service.server";

export interface EbayCategorySuggestion {
  categoryId: string;
  categoryName: string;
  categoryTreeNodeLevel: number;
  categoryTreeNodeAncestors?: Array<{ categoryId: string; categoryName: string }>;
}

function taxonomyHost(env: string) {
  return env === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";
}

// EBAY_US marketplace → tree id 0
const DEFAULT_TREE_ID = "0";

export async function getCategorySuggestions(query: string): Promise<EbayCategorySuggestion[]> {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const token = await getValidEbayAccessToken();
  const url =
    `${taxonomyHost(env)}/commerce/taxonomy/v1/category_tree/${DEFAULT_TREE_ID}` +
    `/get_category_suggestions?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Taxonomy API ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    categorySuggestions?: Array<{
      category: { categoryId: string; categoryName: string };
      categoryTreeNodeLevel: number;
      categoryTreeNodeAncestors?: Array<{ categoryId: string; categoryName: string }>;
    }>;
  };
  return (json.categorySuggestions ?? []).map((s) => ({
    categoryId: s.category.categoryId,
    categoryName: s.category.categoryName,
    categoryTreeNodeLevel: s.categoryTreeNodeLevel,
    categoryTreeNodeAncestors: s.categoryTreeNodeAncestors,
  }));
}
