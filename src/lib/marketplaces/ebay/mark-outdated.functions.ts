import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Marks the eBay draft listing for a product as outdated, so the UI prompts the
 * user to recreate the draft before publishing. Safe to call even when no draft
 * exists or when the listing is already active — it becomes a no-op in those cases.
 */
export const markEbayDraftOutdatedForProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        productId: z.string().uuid(),
        reason: z.string().min(1).max(120).default("product_edited"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; marked: boolean }> => {
    const { data: listing } = await context.supabase
      .from("marketplace_listings")
      .select("id, status, external_listing_id, provider_metadata")
      .eq("product_id", data.productId)
      .eq("marketplace", "ebay")
      .maybeSingle();

    if (!listing || listing.status === "active" || listing.external_listing_id) {
      return { ok: true, marked: false };
    }

    const meta = (listing.provider_metadata ?? {}) as Record<string, unknown>;
    await context.supabase
      .from("marketplace_listings")
      .update({
        provider_metadata: {
          ...meta,
          draftOutdated: true,
          draftOutdatedReason: data.reason,
          draftOutdatedAt: new Date().toISOString(),
        },
        error_message: "eBay draft is outdated. Recreate draft before publishing.",
      })
      .eq("id", listing.id);

    return { ok: true, marked: true };
  });
