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
