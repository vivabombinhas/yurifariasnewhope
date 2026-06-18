import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MarketplaceId } from "@/lib/marketplaces";

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
  action: z.enum(["publish", "update", "close"]).default("publish"),
});

/**
 * Enqueue a publishing job. No external API call is performed at this stage —
 * jobs are inserted as `pending` into publishing_jobs and visible in the
 * Publishing Queue. A future executor will process them.
 */
export const publishToMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Snapshot a minimal payload so the executor has what it needs even if
    // the product changes before the job runs.
    const { data: product, error: pErr } = await supabase
      .from("products")
      .select(
        "id, sku, title, description, price_cents, currency, condition, condition_grade, condition_notes, shipping_notes, item_specifics",
      )
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

    const { data: job, error } = await supabase
      .from("publishing_jobs")
      .insert({
        product_id: data.productId,
        marketplace: data.marketplace,
        action: data.action,
        status: "pending",
        payload: product as any,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { ok: true, jobId: job.id, queued: true };
  });
