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
    const publishAttemptId = crypto.randomUUID();
    const env = String(process.env.EBAY_ENV ?? "sandbox").toLowerCase();
    const isProd = env === "production";
    if (!isProd && env !== "sandbox") {
      return { ok: false, errorMessage: "Publish is sandbox-only for now." };
    }

    // ---------- STEP 1: Load product + listing ----------
    const { data: initialListing, error } = await context.supabase
      .from("marketplace_listings")
      .select("id, status, external_listing_id, listing_url, provider_metadata")
      .eq("product_id", data.productId)
      .eq("marketplace", "ebay")
      .maybeSingle();
    if (error) throw error;

    // Step 3: short-circuit if an active listing already exists.
    if (initialListing?.status === "active" && initialListing.external_listing_id) {
      return {
        ok: true,
        result: {
          ok: true,
          listingId: initialListing.external_listing_id,
          raw: {
            status: 200,
            json: { existing: true, listingUrl: initialListing.listing_url },
            text: "existing active listing",
          },
        },
      };
    }

    let listing = initialListing;
    let meta = (listing?.provider_metadata ?? {}) as Record<string, any>;
    let offerId: string | undefined = meta.offerId;

    // Auto-create draft if missing — single-click publish flow.
    if (!listing || !offerId) {
      const { createEbayDraft } = await import("./draft.functions");
      const draft = await createEbayDraft({ data: { productId: data.productId } });
      if (!draft.ok || !draft.offerId) {
        return {
          ok: false,
          errorMessage: draft.errorMessage ?? "Failed to create eBay draft before publish.",
        };
      }
      const { data: refreshedListing } = await context.supabase
        .from("marketplace_listings")
        .select("id, status, external_listing_id, listing_url, provider_metadata")
        .eq("product_id", data.productId)
        .eq("marketplace", "ebay")
        .maybeSingle();
      if (!refreshedListing) {
        return { ok: false, errorMessage: "Draft created but listing record not found." };
      }
      listing = refreshedListing;
      meta = (refreshedListing.provider_metadata ?? {}) as Record<string, any>;
      offerId = meta.offerId ?? draft.offerId;
    }
    if (!offerId) {
      return { ok: false, errorMessage: "Failed to obtain eBay offer for publish." };
    }
    if (meta.draftOutdated === true) {
      return {
        ok: false,
        errorMessage:
          "The eBay draft is outdated because the category or official eBay Condition changed. Recreate the eBay draft before publishing.",
      };
    }

    const { data: product, error: pErr } = await context.supabase
      .from("products")
      .select(
        "sku, title, description, price_cents, condition, ebay_category_id, ebay_condition_id, ebay_condition_enum, ebay_condition_name, ebay_aspects, updated_at",
      )
      .eq("id", data.productId)
      .maybeSingle();
    if (pErr) throw pErr;

    // ---------- STEP 2: Non-repairable selection checks ----------
    if (
      !product?.sku ||
      !product.ebay_category_id ||
      !product.ebay_condition_id ||
      !product.ebay_condition_enum ||
      !product.ebay_condition_name
    ) {
      await context.supabase
        .from("marketplace_listings")
        .update({
          provider_metadata: {
            ...meta,
            draftOutdated: true,
            draftOutdatedReason: "missing_official_ebay_condition",
            draftOutdatedAt: new Date().toISOString(),
          },
          error_message:
            "Select the official eBay Condition and recreate the eBay draft before publishing.",
          last_failed_step: "condition_validate",
          last_error: JSON.parse(
            JSON.stringify({
              code: "MISSING_OFFICIAL_EBAY_CONDITION",
              message:
                "Official eBay Condition is missing locally, so an existing draft cannot be safely published.",
              productId: data.productId,
              sku: product?.sku ?? null,
              offerId,
            }),
          ) as Json,
        })
        .eq("id", listing.id);
      return {
        ok: false,
        errorMessage:
          "Select the official eBay Condition and recreate the eBay draft before publishing.",
      };
    }
    const { assertConditionIdEnumMatch, getEbayConditionPolicies } =
      await import("./condition-policies.server");
    try {
      assertConditionIdEnumMatch(product.ebay_condition_id, product.ebay_condition_enum);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await context.supabase
        .from("marketplace_listings")
        .update({
          error_message: msg,
          last_failed_step: "condition_validate",
          last_error: JSON.parse(msg) as Json,
        })
        .eq("id", listing.id);
      return { ok: false, errorMessage: msg };
    }

    const productCategoryConditionPolicies = await getEbayConditionPolicies(
      product.ebay_category_id,
    );
    const productCategoryConditionAllowed = productCategoryConditionPolicies.some(
      (p) =>
        p.conditionEnum === product.ebay_condition_enum &&
        p.conditionId === product.ebay_condition_id,
    );
    if (!productCategoryConditionAllowed) {
      const msg = JSON.stringify({
        code: "INVALID_EBAY_CONDITION_FOR_CATEGORY",
        message:
          "Selected eBay Condition is not allowed by the current product category. Reselect eBay Condition before publishing.",
        publishAttemptId,
        productId: data.productId,
        sku: product.sku,
        ebayCategoryId: product.ebay_category_id,
        selectedEbayConditionId: product.ebay_condition_id,
        selectedEbayConditionName: product.ebay_condition_name,
        selectedEbayConditionEnum: product.ebay_condition_enum,
        allowedConditions: productCategoryConditionPolicies.map((p) => ({
          conditionId: p.conditionId,
          conditionName: p.displayName,
          conditionEnum: p.conditionEnum,
        })),
      });
      await context.supabase
        .from("marketplace_listings")
        .update({
          error_message: msg.slice(0, 2000),
          last_failed_step: "condition_for_category",
          last_error: JSON.parse(msg) as Json,
        })
        .eq("id", listing.id);
      return { ok: false, errorMessage: msg };
    }
    let ebayInventorySku = typeof meta.sku === "string" && meta.sku.trim() ? meta.sku : product.sku!;

    // Initial read-only audit (used to decide repair vs publish).
    const { readEbayPublishAuditResources } = await import("./publish-audit.server");
    const readAudit = async (currentOfferId: string) => {
      const r = await readEbayPublishAuditResources({ sku: ebayInventorySku, offerId: currentOfferId });
      const inventoryJson =
        r.inventoryItemRaw.json && typeof r.inventoryItemRaw.json === "object"
          ? r.inventoryItemRaw.json
          : {};
      const offerJson =
        r.offerRaw?.json && typeof r.offerRaw.json === "object" ? r.offerRaw.json : {};
      const allOffers: any[] = Array.isArray(r.offersForSkuRaw.json?.offers)
        ? r.offersForSkuRaw.json.offers
        : [];
      const unpublishedOfferCount = allOffers.filter(
        (o) => String(o?.status ?? "").toUpperCase() === "UNPUBLISHED",
      ).length;
      const hasPublishedListing = allOffers.some(
        (o) =>
          !!o?.listingId ||
          !!o?.listing?.listingId ||
          String(o?.status ?? "").toUpperCase() === "PUBLISHED",
      );
      const offerCreatedAt = new Date(
        String(offerJson.createdDate ?? offerJson.createdAt ?? 0),
      ).getTime();
      return {
        r,
        inventoryJson,
        offerJson,
        allOffers,
        unpublishedOfferCount,
        hasPublishedListing,
        offerCreatedAt,
      };
    };

    let audit = await readAudit(offerId);

    // Non-repairable: condition must be allowed by category policies.
    const conditionAllowed = audit.r.conditionPoliciesTable.some(
      (p) =>
        p.conditionEnum === product.ebay_condition_enum &&
        p.conditionId === product.ebay_condition_id,
    );
    if (!conditionAllowed) {
      const msg = JSON.stringify({
        code: "INVALID_EBAY_CONDITION_FOR_CATEGORY",
        message: "Selected eBay Condition is not allowed by the current category policies.",
        publishAttemptId,
        productId: data.productId,
        sku: ebayInventorySku,
        internalSku: product.sku,
        ebayCategoryId: product.ebay_category_id,
        selectedEbayConditionId: product.ebay_condition_id,
        selectedEbayConditionEnum: product.ebay_condition_enum,
        allowedConditions: audit.r.conditionPoliciesTable,
      });
      await context.supabase
        .from("marketplace_listings")
        .update({
          error_message: msg.slice(0, 2000),
          last_failed_step: "condition_for_category",
          last_error: JSON.parse(msg) as Json,
        })
        .eq("id", listing.id);
      return { ok: false, errorMessage: msg };
    }

    // Non-repairable: another published listing exists on eBay for this SKU
    // that we don't know about locally. Refuse to touch it.
    if (audit.hasPublishedListing && !listing.external_listing_id) {
      const msg = JSON.stringify({
        code: "PUBLISHED_LISTING_EXISTS_REMOTELY",
        message:
          "An active listing already exists on eBay for this SKU but is not linked locally. Resolve manually before republishing.",
        publishAttemptId,
        productId: data.productId,
        sku: ebayInventorySku,
        internalSku: product.sku,
        offers: audit.allOffers.map((o) => ({
          offerId: o?.offerId,
          status: o?.status,
          listingId: o?.listingId ?? o?.listing?.listingId,
        })),
      });
      await context.supabase
        .from("marketplace_listings")
        .update({
          error_message: msg.slice(0, 2000),
          last_failed_step: "pre_publish_audit",
          last_error: JSON.parse(msg) as Json,
        })
        .eq("id", listing.id);
      return { ok: false, errorMessage: msg };
    }

    // ---------- STEPS 4-9: Repair InventoryItem + Offer if reparable drift exists ----------
    const inventoryDrift =
      String(audit.inventoryJson.condition ?? "") !== product.ebay_condition_enum;
    const offerCategoryDrift =
      String(audit.offerJson.categoryId ?? "") !== String(product.ebay_category_id);
    const offerSkuDrift = String(audit.offerJson.sku ?? "") !== ebayInventorySku;
    // eBay Sandbox does not reliably return createdDate for GET /offer/{id}.
    // Do not infer staleness from missing timestamps; explicit draftOutdated
    // is the source of truth when category/condition changes require a new draft.
    const offerStale = meta.draftOutdated === true;
    const duplicateUnpublished = audit.unpublishedOfferCount > 1;
    const missingUnpublished = audit.unpublishedOfferCount === 0;
    const needsRepair =
      inventoryDrift ||
      offerCategoryDrift ||
      offerSkuDrift ||
      offerStale ||
      duplicateUnpublished ||
      missingUnpublished ||
      meta.draftOutdated === true;

    console.log("[ebayPublish] repair decision", {
      publishAttemptId,
      productId: data.productId,
      sku: ebayInventorySku,
      internalSku: product.sku,
      offerId,
      inventoryDrift,
      offerCategoryDrift,
      offerSkuDrift,
      offerStale,
      duplicateUnpublished,
      missingUnpublished,
      draftOutdated: meta.draftOutdated === true,
      needsRepair,
    });

    if (needsRepair) {
      // Use the existing createEbayDraft pipeline — it deletes stale UNPUBLISHED
      // offers, PUT InventoryItem with the selected condition, GET-verifies it
      // (recreating from scratch if remote condition is still stale), and POSTs
      // a fresh UNPUBLISHED Offer. Never touches PUBLISHED offers.
      const { createEbayDraft } = await import("./draft.functions");
      const draft = await createEbayDraft({ data: { productId: data.productId } });
      if (!draft.ok || !draft.offerId) {
        const msg = draft.errorMessage ?? "Failed to repair eBay draft before publish.";
        await context.supabase
          .from("marketplace_listings")
          .update({
            error_message: msg.slice(0, 2000),
            last_failed_step: "draft_repair",
            last_error: JSON.parse(
              JSON.stringify({ message: msg, previousOfferId: offerId }),
            ) as Json,
          })
          .eq("id", listing.id);
        return { ok: false, errorMessage: msg };
      }
      offerId = draft.offerId;
      ebayInventorySku = draft.sku ?? ebayInventorySku;

      // Re-read listing meta after createEbayDraft updated it.
      const { data: refreshedListing } = await context.supabase
        .from("marketplace_listings")
        .select("provider_metadata")
        .eq("id", listing.id)
        .maybeSingle();
      meta = (refreshedListing?.provider_metadata ?? meta) as Record<string, any>;
      meta.offerId = offerId;
      meta.publishAttemptId = publishAttemptId;
    }

    // ---------- Ensure merchant location + policies on Offer ----------
    let locationInfo: {
      merchantLocationKey: string;
      status?: string;
      country?: string;
      postalCode?: string;
      city?: string;
      stateOrProvince?: string;
      created?: boolean;
    };
    try {
      const { setOfferMerchantLocation, syncOfferWithSellerSetup } =
        await import("./seller-setup.server");
      const { requireConfiguredShippingOrigin } = await import(
        "./shipping-origin.server"
      );
      // Use the strict, user-configured shipping origin (same path the
      // "Apply shipping origin to active listings" button uses) so newly
      // published items always show the correct origin without a manual sync.
      const configured = await requireConfiguredShippingOrigin(context.supabase);
      locationInfo = {
        merchantLocationKey: configured.merchantLocationKey,
        status: configured.view.merchantLocationStatus,
        country: configured.view.country ?? undefined,
        postalCode: configured.view.postalCode ?? undefined,
        city: configured.view.city ?? undefined,
        stateOrProvince: configured.view.stateOrProvince ?? undefined,
      };
      await setOfferMerchantLocation(offerId, locationInfo.merchantLocationKey);
      // Always (re)apply listingPolicies — fulfillment/payment/return — to the
      // unpublished Offer. Also repairs the Fulfillment Policy if it is missing
      // a valid shipping service (eBay errorId 25007).
      await syncOfferWithSellerSetup(offerId, locationInfo.merchantLocationKey);
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

    // ---------- STEP 10: Final audit (must be perfect to publish) ----------
    audit = await readAudit(offerId);
    // eBay Sandbox often omits createdDate on getOffer; keep the effective
    // value only for diagnostics, not as a hard publish blocker.
    const draftCreatedAtMs = new Date(String(meta.draftCreatedAt ?? 0)).getTime();
    const finalOfferCreatedAt = Number.isFinite(audit.offerCreatedAt) && audit.offerCreatedAt > 0
      ? audit.offerCreatedAt
      : draftCreatedAtMs;
    const finalCheck = {
      inventorySkuOk: String(audit.inventoryJson.sku ?? ebayInventorySku) === ebayInventorySku,
      offerSkuOk: String(audit.offerJson.sku ?? "") === ebayInventorySku,
      offerCategoryOk:
        String(audit.offerJson.categoryId ?? "") === String(product.ebay_category_id),
      inventoryConditionOk:
        String(audit.inventoryJson.condition ?? "") === product.ebay_condition_enum,
      conditionAllowedOk: audit.r.conditionPoliciesTable.some(
        (p) =>
          p.conditionEnum === product.ebay_condition_enum &&
          p.conditionId === product.ebay_condition_id,
      ),
      offerFresherThanProductOk: meta.draftOutdated !== true,
      exactlyOneUnpublishedOk: audit.unpublishedOfferCount === 1,
      noPublishedListingOk: !audit.hasPublishedListing,
    };
    const finalOk = Object.values(finalCheck).every(Boolean);
    if (!finalOk) {
      const msg = JSON.stringify({
        code: "EBAY_PUBLISH_FINAL_AUDIT_FAILED",
        message: "Final audit failed after repair. Publish blocked.",
        publishAttemptId,
        productId: data.productId,
        sku: ebayInventorySku,
        internalSku: product.sku,
        offerId,
        localCategoryId: product.ebay_category_id,
        offerCategoryId: audit.offerJson.categoryId ?? null,
        localConditionEnum: product.ebay_condition_enum,
        inventoryCondition: audit.inventoryJson.condition ?? null,
        unpublishedOfferCount: audit.unpublishedOfferCount,
        hasPublishedListing: audit.hasPublishedListing,
        offerCreatedAt: audit.offerJson.createdDate ?? audit.offerJson.createdAt ?? null,
        effectiveOfferCreatedAt: Number.isFinite(finalOfferCreatedAt)
          ? new Date(finalOfferCreatedAt).toISOString()
          : null,
        draftCreatedAt: meta.draftCreatedAt ?? null,
        productUpdatedAt: product.updated_at,
        finalCheck,
      });
      await context.supabase
        .from("marketplace_listings")
        .update({
          error_message: msg.slice(0, 2000),
          last_failed_step: "final_audit",
          last_error: JSON.parse(msg) as Json,
        })
        .eq("id", listing.id);
      return { ok: false, errorMessage: msg };
    }

    // ---------- STEP 11: Publish (single attempt, no retry) ----------
    try {
      const { publishOffer } = await import("./publish.server");
      const result = await publishOffer(offerId, publishAttemptId);

      const conditionVerificationJson = JSON.parse(
        JSON.stringify({
          internalCondition: product.condition ?? null,
          ebayCategoryId: product.ebay_category_id,
          selectedEbayConditionId: product.ebay_condition_id,
          selectedEbayConditionName: product.ebay_condition_name,
          selectedEbayConditionEnum: product.ebay_condition_enum,
          putSentCondition: product.ebay_condition_enum,
          getReturnedCondition: audit.inventoryJson.condition ?? null,
          offerId,
        }),
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
        sku: ebayInventorySku,
        internalSku: product.sku,
        publishAttemptId,
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
        publishAttemptId,
        productId: data.productId,
        sku: ebayInventorySku,
        internalSku: product.sku,
        offerId,
        merchantLocationKey: locationInfo.merchantLocationKey,
        locationStatus: locationInfo.status,
        locationCountry: locationInfo.country,
        locationPostalCode: locationInfo.postalCode,
        ok: result.ok,
        listingId: result.ok ? result.listingId : undefined,
        status: result.raw.status,
        finalCheck,
      });

      return { ok: true, result };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[ebayPublish] failed", {
        publishAttemptId,
        productId: data.productId,
        offerId,
        error: msg,
      });
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
