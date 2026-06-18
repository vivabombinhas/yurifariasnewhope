import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface EbayCategorySuggestionDTO {
  categoryId: string;
  categoryName: string;
  categoryTreeNodeLevel: number;
  ancestors: Array<{ categoryId: string; categoryName: string }>;
}

export const fetchEbayCategorySuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ productId: z.string().uuid(), query: z.string().min(1).max(350) }).parse(d),
  )
  .handler(async ({ data }): Promise<{ suggestions: EbayCategorySuggestionDTO[] }> => {
    const { getCategorySuggestions } = await import("./taxonomy.server");
    const suggestions = await getCategorySuggestions(data.query);
    console.log("[eBay taxonomy]", {
      product_id: data.productId,
      query: data.query,
      suggestions_count: suggestions.length,
    });
    return {
      suggestions: suggestions.map((s) => ({
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        categoryTreeNodeLevel: s.categoryTreeNodeLevel,
        ancestors: s.categoryTreeNodeAncestors ?? [],
      })),
    };
  });

export const saveEbayCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        productId: z.string().uuid(),
        categoryId: z.string().min(1),
        categoryName: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        source: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("products")
      .update({
        ebay_category_id: data.categoryId,
        ebay_category_name: data.categoryName,
        ebay_category_confidence: data.confidence ?? null,
        ebay_category_source: data.source ?? "ebay_taxonomy_api",
      })
      .eq("id", data.productId);
    if (error) throw error;
    console.log("[eBay taxonomy]", {
      product_id: data.productId,
      selected_category_id: data.categoryId,
    });
    return { ok: true };
  });

export interface EbayAspectDTO {
  name: string;
  required: boolean;
  mode: "REQUIRED" | "RECOMMENDED" | "OPTIONAL";
  cardinality: "SINGLE" | "MULTI";
  dataType: "STRING" | "NUMBER" | "DATE";
  selectionMode: "FREE_TEXT" | "SELECTION_ONLY";
  values: string[];
}

export const fetchEbayAspectsForCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ categoryId: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }): Promise<{ aspects: EbayAspectDTO[] }> => {
    const { getItemAspectsForCategory } = await import("./taxonomy.server");
    const aspects = await getItemAspectsForCategory(data.categoryId);
    console.log("[eBay aspects]", {
      category_id: data.categoryId,
      aspects_count: aspects.length,
    });
    return { aspects };
  });

export const saveEbayAspects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        productId: z.string().uuid(),
        aspects: z.record(z.string(), z.array(z.string())),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("products")
      .update({ ebay_aspects: data.aspects })
      .eq("id", data.productId);
    if (error) throw error;
    console.log("[eBay aspects]", {
      product_id: data.productId,
      saved_keys: Object.keys(data.aspects).length,
    });
    return { ok: true };
  });

