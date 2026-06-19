import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
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
      .select("id, status, external_listing_id, listing_url, provider_metadata")
      .eq("product_id", data.productId)
      .eq("marketplace", "ebay")
      .maybeSingle();
    if (error) throw error;

    if (listing?.status === "active" && listing.external_listing_id) {
      return {
        ok: true,
        result: {
          ok: true,
          listingId: listing.external_listing_id,
          raw: {
            status: 200,
            json: { existing: true, listingUrl: listing.listing_url },
            text: "existing active listing",
          },
        },
      };
    }

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
      .select("sku, title, description, price_cents, condition, ebay_category_id, ebay_condition_id, ebay_condition_enum, ebay_condition_name, ebay_aspects")
      .eq("id", data.productId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (
      !product?.sku ||
      !product.ebay_category_id ||
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

    const { verifyEbayInventoryItemCondition } = await import("./draft.server");
    let inventoryVerification: Awaited<ReturnType<typeof verifyEbayInventoryItemCondition>>;
    try {
      inventoryVerification = await verifyEbayInventoryItemCondition({
        sku: product.sku,
        title: product.title ?? "",
        description: product.description ?? "",
        priceCents: product.price_cents ?? 0,
        internalCondition: product.condition ?? null,
        ebayConditionId: product.ebay_condition_id,
        ebayConditionEnum: product.ebay_condition_enum,
        ebayConditionName: product.ebay_condition_name,
        categoryId: product.ebay_category_id,
        aspects: product.ebay_aspects,
        imageUrls: [],
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      let parsedError: Json;
      try {
        parsedError = JSON.parse(msg) as Json;
      } catch {
        parsedError = { message: msg, offerId } as Json;
      }
      await context.supabase
        .from("marketplace_listings")
        .update({
          error_message: msg,
          last_failed_step: "inventory_verify",
          last_error: parsedError,
        })
        .eq("id", listing.id);
      return { ok: false, errorMessage: msg };
    }

    // Ensure the eBay account has a valid Inventory Location (country=US, ENABLED, postalCode or city+state)
    // and patch the offer to use it. Fixes errorId 25002 "No <Item.Country> exists".
    let locationInfo: { merchantLocationKey: string; status: string; country: string; postalCode?: string; city?: string; stateOrProvince?: string; created: boolean };
    try {
      const { ensureValidMerchantLocation, setOfferMerchantLocation } = await import("./seller-setup.server");
      locationInfo = await ensureValidMerchantLocation(context.supabase);
      await setOfferMerchantLocation(offerId, locationInfo.merchantLocationKey);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await context.supabase
        .from("marketplace_listings")
        .update({
          error_message: msg.slice(0, 2000),
          last_failed_step: "merchant_location",
          last_error: JSON.parse(JSON.stringify({ message: msg, offerId })) as Json,
        })
        .eq("id", listing.id);
      return { ok: false, errorMessage: msg };
    }

    try {
      const { publishOffer } = await import("./publish.server");
      const result = await publishOffer(offerId);

      const conditionVerificationJson = JSON.parse(
        JSON.stringify({ ...inventoryVerification.verification, offerId }),
      ) as Json;
      const publishLastErrorJson = JSON.parse(
        JSON.stringify({
          message: result.ok ? null : result.errorMessage,
          errors: result.ok ? [] : result.errors,
          conditionVerification: conditionVerificationJson,
        }),
      ) as Json;

      const newMeta: Record<string, any> = {
        ...meta,
        marketplace: "ebay",
        offerId,
        conditionVerification: conditionVerificationJson,
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
            last_failed_step: null,
            last_error: null,
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
            last_failed_step: "publish",
            last_error: publishLastErrorJson,
            provider_metadata: newMeta,
          })
          .eq("id", listing.id);
      }

      console.log("[ebayPublish]", {
        productId: data.productId,
        offerId,
        ...inventoryVerification.verification,
        merchantLocationKey: locationInfo.merchantLocationKey,
        locationStatus: locationInfo.status,
        locationCountry: locationInfo.country,
        locationPostalCode: locationInfo.postalCode,
        ok: result.ok,
        listingId: result.ok ? result.listingId : undefined,
        status: result.raw.status,
      });

      return { ok: true, result };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[ebayPublish] failed", { offerId, error: msg });
      await context.supabase
        .from("marketplace_listings")
        .update({
          error_message: msg,
          last_failed_step: "publish",
          last_error: JSON.parse(JSON.stringify({ message: msg, offerId })) as Json,
        })
        .eq("id", listing.id);
      return { ok: false, errorMessage: msg };
    }
  });
