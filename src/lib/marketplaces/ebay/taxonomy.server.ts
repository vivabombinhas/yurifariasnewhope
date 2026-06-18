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

export type EbayAspectMode = "REQUIRED" | "RECOMMENDED" | "OPTIONAL";
export type EbayAspectDataType = "STRING" | "NUMBER" | "DATE";

export interface EbayAspect {
  name: string;
  required: boolean;
  mode: EbayAspectMode;
  cardinality: "SINGLE" | "MULTI";
  dataType: EbayAspectDataType;
  values: string[];
  selectionMode: "FREE_TEXT" | "SELECTION_ONLY";
}

export async function getItemAspectsForCategory(categoryId: string): Promise<EbayAspect[]> {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const token = await getValidEbayAccessToken();
  const url =
    `${taxonomyHost(env)}/commerce/taxonomy/v1/category_tree/${DEFAULT_TREE_ID}` +
    `/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`;

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
    throw new Error(`Taxonomy aspects ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    aspects?: Array<{
      localizedAspectName: string;
      aspectConstraint?: {
        aspectRequired?: boolean;
        aspectUsage?: string;
        itemToAspectCardinality?: "SINGLE" | "MULTI";
        aspectDataType?: EbayAspectDataType;
        aspectMode?: "FREE_TEXT" | "SELECTION_ONLY";
      };
      aspectValues?: Array<{ localizedValue: string }>;
    }>;
  };
  return (json.aspects ?? []).map((a) => {
    const required = !!a.aspectConstraint?.aspectRequired;
    const usage = a.aspectConstraint?.aspectUsage ?? "OPTIONAL";
    const mode: EbayAspectMode = required
      ? "REQUIRED"
      : usage === "RECOMMENDED"
        ? "RECOMMENDED"
        : "OPTIONAL";
    return {
      name: a.localizedAspectName,
      required,
      mode,
      cardinality: a.aspectConstraint?.itemToAspectCardinality ?? "SINGLE",
      dataType: a.aspectConstraint?.aspectDataType ?? "STRING",
      selectionMode: a.aspectConstraint?.aspectMode ?? "FREE_TEXT",
      values: (a.aspectValues ?? []).map((v) => v.localizedValue),
    };
  });
}

