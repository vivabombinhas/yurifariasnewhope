import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

export interface EbayCategorySuggestionDTO {
  categoryId: string;
  categoryName: string;
  categoryTreeNodeLevel: number;
  ancestors: Array<{ categoryId: string; categoryName: string }>;
}

export interface EbayConditionPolicyDTO {
  categoryId: string;
  conditionRequired: boolean;
  conditionId: number;
  displayName: string;
  conditionEnum: string;
  conditionDescriptors: Json[];
  suggested: boolean;
}

async function markEbayDraftOutdated(supabase: any, productId: string, reason: string) {
  const { data: listing } = await supabase
    .from("marketplace_listings")
    .select("id, status, external_listing_id, provider_metadata")
    .eq("product_id", productId)
    .eq("marketplace", "ebay")
    .maybeSingle();
  if (!listing || listing.status === "active" || listing.external_listing_id) return;
  const meta = (listing.provider_metadata ?? {}) as Record<string, unknown>;
  await supabase
    .from("marketplace_listings")
    .update({
      provider_metadata: {
        ...meta,
        draftOutdated: true,
        draftOutdatedReason: reason,
        draftOutdatedAt: new Date().toISOString(),
      },
      error_message: "eBay draft is outdated. Recreate draft before publishing.",
    })
    .eq("id", listing.id);
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
        ebay_condition_id: null,
        ebay_condition_enum: null,
        ebay_condition_name: null,
      })
      .eq("id", data.productId);
    if (error) throw error;
    await markEbayDraftOutdated(context.supabase, data.productId, "category_changed");
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

export const fetchEbayConditionPoliciesForCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ conditions: EbayConditionPolicyDTO[] }> => {
    const { data: product, error } = await context.supabase
      .from("products")
      .select("ebay_category_id, condition, condition_grade, condition_notes")
      .eq("id", data.productId)
      .maybeSingle();
    if (error) throw error;
    if (!product?.ebay_category_id) return { conditions: [] };

    const { getEbayConditionPolicies, suggestEbayConditionPolicy } = await import("./condition-policies.server");
    const policies = await getEbayConditionPolicies(product.ebay_category_id);
    const suggested = suggestEbayConditionPolicy(
      policies,
      product.condition,
      product.condition_grade,
      product.condition_notes,
    );
    console.log("[eBay conditions]", {
      product_id: data.productId,
      category_id: product.ebay_category_id,
      count: policies.length,
      suggestedConditionId: suggested?.conditionId,
      suggestedConditionEnum: suggested?.conditionEnum,
    });
    return {
      conditions: policies.map((p) => ({
        categoryId: p.categoryId,
        conditionRequired: p.conditionRequired,
        conditionId: p.conditionId,
        displayName: p.displayName,
        conditionEnum: p.conditionEnum,
        conditionDescriptors: JSON.parse(JSON.stringify(p.conditionDescriptors ?? [])) as Json[],
        suggested: !!suggested && suggested.conditionId === p.conditionId,
      })),
    };
  });

export const saveEbayCondition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        productId: z.string().uuid(),
        conditionId: z.number().int().positive(),
        conditionEnum: z.string().min(1),
        conditionName: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: product, error: pErr } = await context.supabase
      .from("products")
      .select("ebay_category_id")
      .eq("id", data.productId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!product?.ebay_category_id) throw new Error("Select an eBay category first.");

    const { assertConditionIdEnumMatch, getEbayConditionPolicies } = await import("./condition-policies.server");
    assertConditionIdEnumMatch(data.conditionId, data.conditionEnum);
    const policies = await getEbayConditionPolicies(product.ebay_category_id);
    const selected = policies.find(
      (p) => p.conditionId === data.conditionId && p.conditionEnum === data.conditionEnum,
    );
    if (!selected) throw new Error("Selected eBay condition is not valid for the current category.");

    const { error } = await context.supabase
      .from("products")
      .update({
        ebay_condition_id: selected.conditionId,
        ebay_condition_enum: selected.conditionEnum,
        ebay_condition_name: selected.displayName,
        needs_condition_reselection: false,
      } as any)
      .eq("id", data.productId);
    if (error) throw error;
    await markEbayDraftOutdated(context.supabase, data.productId, "condition_changed");
    console.log("[eBay conditions] saved", {
      product_id: data.productId,
      category_id: product.ebay_category_id,
      ebayConditionId: selected.conditionId,
      ebayConditionEnum: selected.conditionEnum,
      ebayConditionName: selected.displayName,
    });
    return { ok: true };
  });

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

