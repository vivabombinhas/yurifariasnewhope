import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MarketplaceId } from "@/lib/marketplaces";
import { getPublisher } from "@/lib/marketplaces/registry";
import type { PublishableProduct } from "@/lib/marketplaces/types";

const MARKETPLACE_IDS: [MarketplaceId, ...MarketplaceId[]] = [
  "ebay",
  "etsy",
  "facebook_marketplace",
  "poshmark",
  "depop",
];

const Input = z.object({
  productId: z.string().uuid(),
  marketplace: z.enum(MARKETPLACE_IDS),
});

/**
 * Register a publish intent for a product on a marketplace.
 *
 * Foundation only — no real API call yet. We:
 *   1. Load the product.
 *   2. Call the marketplace publisher (currently returns not_implemented).
 *   3. Upsert a marketplace_listings row so the operator can see the intent
 *      and so a future executor can pick it up.
 */
export const publishToMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: product, error: pErr } = await supabase
      .from("products")
      .select(
        "id, sku, title, description, price_cents, currency, condition, brand:brands(name), category:categories(name)",
      )
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

    const publisher = getPublisher(data.marketplace);
    const result = await publisher.publish(product as unknown as PublishableProduct);

    const now = new Date().toISOString();
    // Intent is always recorded, even when the provider is not implemented yet.
    const patch = {
      product_id: data.productId,
      marketplace: data.marketplace,
      status: result.ok ? "active" : ("draft" as const),
      external_listing_id: result.external_listing_id ?? null,
      listing_url: result.listing_url ?? null,
      published_at: result.ok ? now : null,
      last_sync_at: now,
      error_message: result.not_implemented
        ? `Integration pending — intent recorded for ${publisher.label}. No external call performed.`
        : result.error_message ?? null,
    };

    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id")
      .eq("product_id", data.productId)
      .eq("marketplace", data.marketplace)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("marketplace_listings")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("marketplace_listings").insert(patch);
      if (error) throw new Error(error.message);
    }

    return {
      ok: result.ok,
      not_implemented: !!result.not_implemented,
      marketplace: data.marketplace,
      message: patch.error_message,
    };
  });
