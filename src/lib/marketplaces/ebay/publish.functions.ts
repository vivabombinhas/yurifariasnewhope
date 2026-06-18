import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { EbayPublishResult } from "./publish.server";

export type EbayPublishDTO =
  | { ok: true; result: EbayPublishResult }
  | { ok: false; errorMessage: string };

export const publishEbayListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<EbayPublishDTO> => {
    const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
    if (env !== "sandbox") {
      return { ok: false, errorMessage: "Publish is sandbox-only for now." };
    }

    const { data: listing, error } = await context.supabase
      .from("marketplace_listings")
      .select("id, provider_metadata")
      .eq("product_id", data.productId)
      .eq("marketplace", "ebay")
      .maybeSingle();
    if (error) throw error;

    const meta = (listing?.provider_metadata ?? {}) as Record<string, any>;
    const offerId: string | undefined = meta.offerId;
    if (!listing || !offerId) {
      return { ok: false, errorMessage: "No eBay offer found. Create a draft first." };
    }

    try {
      const { publishOffer } = await import("./publish.server");
      const result = await publishOffer(offerId);

      const newMeta: Record<string, any> = {
        ...meta,
        marketplace: "ebay",
        offerId,
        lastPublishRaw: result.raw,
      };

      if (result.ok) {
        newMeta.listingId = result.listingId;
        newMeta.publishStatus = "PUBLISHED";
        const { error: upErr } = await context.supabase
          .from("marketplace_listings")
          .update({
            status: "active",
            external_listing_id: result.listingId,
            published_at: new Date().toISOString(),
            error_message: null,
            provider_metadata: newMeta,
          })
          .eq("id", listing.id);
        if (upErr) throw upErr;
      } else {
        newMeta.publishStatus = "FAILED";
        await context.supabase
          .from("marketplace_listings")
          .update({
            error_message: result.errorMessage.slice(0, 2000),
            provider_metadata: newMeta,
          })
          .eq("id", listing.id);
      }

      console.log("[ebayPublish]", {
        productId: data.productId,
        offerId,
        ok: result.ok,
        listingId: result.ok ? result.listingId : undefined,
        status: result.raw.status,
      });

      return { ok: true, result };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[ebayPublish] failed", { offerId, error: msg });
      return { ok: false, errorMessage: msg };
    }
  });
