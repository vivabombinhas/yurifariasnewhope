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
    const env = String(process.env.EBAY_ENV ?? "sandbox").toLowerCase();
    const isProd = env === "production";
    if (!isProd && env !== "sandbox") {
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
    if (meta.draftOutdated) {
      return {
        ok: false,
        errorMessage: "eBay draft is outdated because category or condition changed. Recreate eBay Draft before publishing.",
      };
    }

    const { data: product, error: pErr } = await context.supabase
      .from("products")
      .select("ebay_category_id, ebay_condition_id, ebay_condition_enum, ebay_condition_name")
      .eq("id", data.productId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (
      !product?.ebay_category_id ||
      !product.ebay_condition_id ||
      !product.ebay_condition_enum ||
      !product.ebay_condition_name ||
      meta.categoryId !== product.ebay_category_id ||
      meta.ebayConditionId !== product.ebay_condition_id ||
      meta.ebayConditionEnum !== product.ebay_condition_enum
    ) {
      return {
        ok: false,
        errorMessage: "eBay draft does not match the selected category/condition. Recreate eBay Draft before publishing.",
      };
    }

    const { getEbayConditionPolicies } = await import("./condition-policies.server");
    const validCondition = (await getEbayConditionPolicies(product.ebay_category_id)).some(
      (c) =>
        c.conditionId === product.ebay_condition_id &&
        c.conditionEnum === product.ebay_condition_enum &&
        c.displayName === product.ebay_condition_name,
    );
    if (!validCondition) {
      return {
        ok: false,
        errorMessage: "Selected eBay Condition is no longer valid for this category. Select eBay Condition again and recreate draft.",
      };
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
        const listingUrl = isProd
          ? `https://www.ebay.com/itm/${result.listingId}`
          : `https://www.sandbox.ebay.com/itm/${result.listingId}`;
        newMeta.listingId = result.listingId;
        newMeta.listingUrl = listingUrl;
        newMeta.publishStatus = "PUBLISHED";
        const { error: upErr } = await context.supabase
          .from("marketplace_listings")
          .update({
            status: "active",
            external_listing_id: result.listingId,
            listing_url: listingUrl,
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
