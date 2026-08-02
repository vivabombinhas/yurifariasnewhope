import type { MarketplaceId } from "@/lib/marketplaces";
import { withdrawEbayListingForProduct } from "@/lib/marketplaces/ebay/end-listing.functions";

export type ListingClosureResult = {
  marketplace: MarketplaceId;
  listingUrl: string | null;
  externalListingId: string | null;
  status: "closed" | "manual_required" | "failed";
  message: string;
};

export async function closeOtherActiveListings(
  supabase: any,
  productId: string,
  soldOn?: MarketplaceId,
): Promise<ListingClosureResult[]> {
  const { data: listings, error } = await supabase
    .from("marketplace_listings")
    .select("id, marketplace, listing_url, external_listing_id, provider_metadata")
    .eq("product_id", productId)
    .eq("status", "active");
  if (error) throw error;

  const results: ListingClosureResult[] = [];
  for (const listing of listings ?? []) {
    const marketplace = listing.marketplace as MarketplaceId;
    if (marketplace === soldOn) continue;

    if (marketplace === "ebay") {
      try {
        const result = await withdrawEbayListingForProduct(supabase, productId);
        results.push({
          marketplace,
          listingUrl: listing.listing_url,
          externalListingId: listing.external_listing_id,
          status: result.ok ? "closed" : "failed",
          message: result.ok ? "eBay listing ended automatically." : result.errorMessage,
        });
      } catch (error) {
        results.push({
          marketplace,
          listingUrl: listing.listing_url,
          externalListingId: listing.external_listing_id,
          status: "failed",
          message: error instanceof Error ? error.message : "Could not end the eBay listing.",
        });
      }
      continue;
    }

    const message = `Open the saved ${marketplace.replace(/_/g, " ")} listing and mark it not for sale.`;
    await supabase
      .from("marketplace_listings")
      .update({
        last_failed_step: "manual_close_required",
        error_message: message,
        provider_metadata: {
          ...((listing.provider_metadata as Record<string, unknown>) ?? {}),
          closurePending: true,
          closureRequestedAt: new Date().toISOString(),
          soldOn: soldOn ?? null,
        },
      })
      .eq("id", listing.id);

    results.push({
      marketplace,
      listingUrl: listing.listing_url,
      externalListingId: listing.external_listing_id,
      status: "manual_required",
      message,
    });
  }

  return results;
}
