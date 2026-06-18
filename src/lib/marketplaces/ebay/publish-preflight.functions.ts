import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { PreflightResult } from "./publish-preflight.server";

export type EbayPublishPreflightDTO =
  | { ok: true; result: PreflightResult }
  | { ok: false; errorMessage: string };

export const checkEbayPublishPreflight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<EbayPublishPreflightDTO> => {
    const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
    if (env !== "sandbox") {
      return { ok: false, errorMessage: "Publish preflight is sandbox-only for now." };
    }

    const { data: listing, error } = await context.supabase
      .from("marketplace_listings")
      .select("provider_metadata, status")
      .eq("product_id", data.productId)
      .eq("marketplace", "ebay")
      .maybeSingle();
    if (error) throw error;

    const offerId = (listing?.provider_metadata as { offerId?: string } | null)?.offerId;
    if (!offerId) {
      return { ok: false, errorMessage: "No eBay offer found. Create a draft first." };
    }

    try {
      const { inspectOfferForPublish } = await import("./publish-preflight.server");
      const result = await inspectOfferForPublish(offerId);
      console.log("[ebayPublishPreflight]", {
        productId: data.productId,
        offerId,
        ready: result.ready,
      });
      return { ok: true, result };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[ebayPublishPreflight] failed", { offerId, error: msg });
      return { ok: false, errorMessage: msg };
    }
  });
