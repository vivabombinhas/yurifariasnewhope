import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type EbayPublishAuditConclusion =
  | "CATEGORY_DRIFT"
  | "CONDITION_NOT_PERSISTED"
  | "INVENTORY_CONDITION_DRIFT"
  | "CONDITION_NOT_ALLOWED_FOR_OFFER_CATEGORY"
  | "STALE_OFFER"
  | "DUPLICATE_UNPUBLISHED_OFFERS"
  | "EBAY_REJECTED_ALLOWED_CONDITION";

type RawEbayResponse = {
  ok: boolean;
  status: number;
  json: any | null;
  text: string;
};

type NullableString = string | null;

export interface EbayPublishAuditReport {
  generatedAt: string;
  localProduct: {
    productId: string;
    sku: NullableString;
    internalCondition: NullableString;
    ebayCategoryId: NullableString;
    ebayCategoryName: NullableString;
    ebayConditionId: number | null;
    ebayConditionName: NullableString;
    ebayConditionEnum: NullableString;
    lastChangedAt: NullableString;
    fieldTimestamps: {
      productUpdatedAt: NullableString;
      listingUpdatedAt: NullableString;
      draftOutdatedAt: NullableString;
      draftCreatedAt: NullableString;
      offerCreatedAt: NullableString;
    };
  };
  inventoryItem: {
    sku: NullableString;
    condition: NullableString;
    conditionDescription: NullableString;
    title: NullableString;
    raw: RawEbayResponse | null;
  };
  offer: {
    offerId: NullableString;
    status: NullableString;
    sku: NullableString;
    marketplaceId: NullableString;
    categoryId: NullableString;
    merchantLocationKey: NullableString;
    listingPolicies: any | null;
    listingId: NullableString;
    raw: RawEbayResponse | null;
  };
  categoryConditionPolicies: {
    marketplaceId: NullableString;
    categoryId: NullableString;
    raw: RawEbayResponse | null;
    table: Array<{
      conditionId: number;
      conditionDisplayName: NullableString;
      conditionEnum: string;
    }>;
  };
  comparisons: {
    dbCategoryIdEqualsOfferCategoryId: boolean;
    dbConditionEnumEqualsInventoryCondition: boolean;
    inventoryConditionAllowedForOfferCategory: boolean;
    dbConditionIdAllowedForOfferCategory: boolean;
    offerIsNewOrOld: "new" | "old" | "unknown";
    offerCreatedBeforeOrAfterLastConditionChange: "before" | "after" | "same" | "unknown";
    otherUnpublishedOffersForSku: Array<{ offerId: string; status: string | null; categoryId: string | null }>;
    hasPublishedListingForSku: boolean;
    unpublishedOfferCountForSku: number;
  };
  conclusion: EbayPublishAuditConclusion;
}

type OfferSummaryRow = {
  offerId: string;
  status: string | null;
  categoryId: string | null;
  listingId: string | null;
  createdAt: string | null;
};

function asRecord(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textOrNull(value: any): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length ? text : null;
}

function numberOrNull(value: any): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function listingIdFromOffer(offer: Record<string, any>): string | null {
  return textOrNull(offer.listingId) ?? textOrNull(offer.listing?.listingId);
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function classifyConclusion(input: {
  dbCategoryIdEqualsOfferCategoryId: boolean;
  dbConditionEnum: string | null;
  dbConditionId: number | null;
  inventoryCondition: string | null;
  dbConditionEnumEqualsInventoryCondition: boolean;
  inventoryConditionAllowedForOfferCategory: boolean;
  dbConditionIdAllowedForOfferCategory: boolean;
  offerCreatedBeforeOrAfterLastConditionChange: "before" | "after" | "same" | "unknown";
  unpublishedOfferCountForSku: number;
}): EbayPublishAuditConclusion {
  if (!input.dbCategoryIdEqualsOfferCategoryId) return "CATEGORY_DRIFT";
  if (!input.dbConditionEnum || !input.dbConditionId) return "CONDITION_NOT_PERSISTED";
  if (!input.dbConditionEnumEqualsInventoryCondition) return "INVENTORY_CONDITION_DRIFT";
  if (!input.inventoryConditionAllowedForOfferCategory || !input.dbConditionIdAllowedForOfferCategory) {
    return "CONDITION_NOT_ALLOWED_FOR_OFFER_CATEGORY";
  }
  if (input.offerCreatedBeforeOrAfterLastConditionChange === "before") return "STALE_OFFER";
  if (input.unpublishedOfferCountForSku > 1) return "DUPLICATE_UNPUBLISHED_OFFERS";
  return "EBAY_REJECTED_ALLOWED_CONDITION";
}

export const generateEbayPublishAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<EbayPublishAuditReport> => {
    const { data: product, error: productError } = await context.supabase
      .from("products")
      .select(
        "id, sku, condition, ebay_category_id, ebay_category_name, ebay_condition_id, ebay_condition_name, ebay_condition_enum, updated_at",
      )
      .eq("id", data.productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) throw new Error("Product not found");

    const { data: listing, error: listingError } = await context.supabase
      .from("marketplace_listings")
      .select(
        "id, status, external_listing_id, listing_url, provider_metadata, created_at, updated_at, last_error, last_failed_step",
      )
      .eq("product_id", data.productId)
      .eq("marketplace", "ebay")
      .maybeSingle();
    if (listingError) throw listingError;

    const meta = asRecord(listing?.provider_metadata);
    const lastError = asRecord(listing?.last_error);
    const offerId =
      textOrNull(meta.offerId) ??
      textOrNull(lastError.offerId) ??
      textOrNull(lastError?.conditionVerification?.offerId);
    const sku = textOrNull(product.sku);

    if (!sku) throw new Error("Product has no SKU; audit cannot query eBay InventoryItem.");

    const { readEbayPublishAuditResources } = await import("./publish-audit.server");
    const resources = await readEbayPublishAuditResources({ sku, offerId });

    const inventoryJson = asRecord(resources.inventoryItemRaw.json);
    const offerJson = asRecord(resources.offerRaw?.json);
    const allOffers = Array.isArray(resources.offersForSkuRaw.json?.offers)
      ? resources.offersForSkuRaw.json.offers.map(asRecord)
      : [];
    const policyTable = resources.conditionPoliciesTable;

    const offerCategoryId = textOrNull(offerJson.categoryId);
    const offerMarketplaceId = textOrNull(offerJson.marketplaceId);
    const inventoryCondition = textOrNull(inventoryJson.condition);
    const dbConditionEnum = textOrNull(product.ebay_condition_enum);
    const dbConditionId = numberOrNull(product.ebay_condition_id);
    const dbCategoryId = textOrNull(product.ebay_category_id);

    const dbCategoryIdEqualsOfferCategoryId = dbCategoryId === offerCategoryId;
    const dbConditionEnumEqualsInventoryCondition = dbConditionEnum === inventoryCondition;
    const inventoryConditionAllowedForOfferCategory = !!inventoryCondition && policyTable.some((p) => p.conditionEnum === inventoryCondition);
    const dbConditionIdAllowedForOfferCategory = dbConditionId != null && policyTable.some((p) => p.conditionId === dbConditionId);

    const currentOfferId = textOrNull(offerJson.offerId) ?? offerId;
    const offerSummaryRows: OfferSummaryRow[] = allOffers.map((offer: Record<string, any>) => ({
      offerId: textOrNull(offer.offerId) ?? "",
      status: textOrNull(offer.status),
      categoryId: textOrNull(offer.categoryId),
      listingId: listingIdFromOffer(offer),
      createdAt: textOrNull(offer.createdDate ?? offer.createdAt),
    }));
    const unpublishedOffers = offerSummaryRows.filter((offer: OfferSummaryRow) => String(offer.status ?? "").toUpperCase() === "UNPUBLISHED");
    const otherUnpublishedOffersForSku = unpublishedOffers
      .filter((offer) => offer.offerId && offer.offerId !== currentOfferId)
      .map((offer) => ({ offerId: offer.offerId, status: offer.status, categoryId: offer.categoryId }));
    const hasPublishedListingForSku =
      !!listing?.external_listing_id ||
      offerSummaryRows.some((offer) => !!offer.listingId || String(offer.status ?? "").toUpperCase() === "PUBLISHED");

    const draftCreatedAt = textOrNull(meta.draftCreatedAt ?? meta.createdAt ?? listing?.created_at);
    const offerCreatedAt =
      textOrNull(offerJson.createdDate ?? offerJson.createdAt) ??
      offerSummaryRows.find((offer) => offer.offerId === currentOfferId)?.createdAt ??
      draftCreatedAt;
    const draftOutdatedAt = textOrNull(meta.draftOutdatedAt);
    const lastChangedAt = draftOutdatedAt ?? textOrNull(product.updated_at);
    const offerMs = timestampMs(offerCreatedAt);
    const changedMs = timestampMs(lastChangedAt);
    const offerCreatedBeforeOrAfterLastConditionChange: "before" | "after" | "same" | "unknown" =
      offerMs == null || changedMs == null
        ? "unknown"
        : offerMs < changedMs
          ? "before"
          : offerMs > changedMs
            ? "after"
            : "same";

    const unpublishedOfferCountForSku = unpublishedOffers.length;
    const dbOfferId = textOrNull(meta.offerId);
    const offerIsNewOrOld: "new" | "old" | "unknown" =
      !currentOfferId || !dbOfferId
        ? "unknown"
        : currentOfferId === dbOfferId && offerCreatedBeforeOrAfterLastConditionChange !== "before"
          ? "new"
          : "old";

    const comparisons = {
      dbCategoryIdEqualsOfferCategoryId,
      dbConditionEnumEqualsInventoryCondition,
      inventoryConditionAllowedForOfferCategory,
      dbConditionIdAllowedForOfferCategory,
      offerIsNewOrOld,
      offerCreatedBeforeOrAfterLastConditionChange,
      otherUnpublishedOffersForSku,
      hasPublishedListingForSku,
      unpublishedOfferCountForSku,
    };

    const conclusion = classifyConclusion({
      dbCategoryIdEqualsOfferCategoryId,
      dbConditionEnum,
      dbConditionId,
      inventoryCondition,
      dbConditionEnumEqualsInventoryCondition,
      inventoryConditionAllowedForOfferCategory,
      dbConditionIdAllowedForOfferCategory,
      offerCreatedBeforeOrAfterLastConditionChange,
      unpublishedOfferCountForSku,
    });

    return {
      generatedAt: new Date().toISOString(),
      localProduct: {
        productId: product.id,
        sku,
        internalCondition: textOrNull(product.condition),
        ebayCategoryId: dbCategoryId,
        ebayCategoryName: textOrNull(product.ebay_category_name),
        ebayConditionId: dbConditionId,
        ebayConditionName: textOrNull(product.ebay_condition_name),
        ebayConditionEnum: dbConditionEnum,
        lastChangedAt,
        fieldTimestamps: {
          productUpdatedAt: textOrNull(product.updated_at),
          listingUpdatedAt: textOrNull(listing?.updated_at),
          draftOutdatedAt,
          draftCreatedAt,
          offerCreatedAt,
        },
      },
      inventoryItem: {
        sku: textOrNull(inventoryJson.sku) ?? sku,
        condition: inventoryCondition,
        conditionDescription: textOrNull(inventoryJson.conditionDescription),
        title: textOrNull(inventoryJson.product?.title),
        raw: resources.inventoryItemRaw,
      },
      offer: {
        offerId: currentOfferId,
        status: textOrNull(offerJson.status),
        sku: textOrNull(offerJson.sku),
        marketplaceId: offerMarketplaceId,
        categoryId: offerCategoryId,
        merchantLocationKey: textOrNull(offerJson.merchantLocationKey),
        listingPolicies: offerJson.listingPolicies ?? null,
        listingId: listingIdFromOffer(offerJson),
        raw: resources.offerRaw,
      },
      categoryConditionPolicies: {
        marketplaceId: offerMarketplaceId,
        categoryId: offerCategoryId,
        raw: resources.conditionPoliciesRaw,
        table: policyTable,
      },
      comparisons,
      conclusion,
    };
  });