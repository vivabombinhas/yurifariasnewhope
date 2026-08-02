import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type EndEbayListingDTO =
  | { ok: true; offerId: string; status: number; raw: any }
  | { ok: false; errorMessage: string; raw?: any };

export async function withdrawEbayListingForProduct(
  supabase: any,
  productId: string,
): Promise<EndEbayListingDTO> {
  const { data: listing, error } = await supabase
    .from("marketplace_listings")
    .select("id, status, external_listing_id, provider_metadata")
    .eq("product_id", productId)
    .eq("marketplace", "ebay")
    .maybeSingle();
  if (error) throw error;
  if (!listing) return { ok: false, errorMessage: "No eBay listing found for this product." };

  const meta = (listing.provider_metadata ?? {}) as Record<string, any>;
  const offerId: string | undefined = meta.offerId;
  if (!offerId) return { ok: false, errorMessage: "Missing offerId on listing metadata." };
  if (listing.status !== "active") {
    return { ok: false, errorMessage: `Listing is not active (status: ${listing.status}).` };
  }

  const env = String(process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const { ebayFetch, ebayErrorMessage } = await import("./draft.server");
  const { getValidEbayAccessToken } = await import("./token-service.server");
  const token = await getValidEbayAccessToken();

  const res = await ebayFetch(
    env,
    "POST",
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`,
    token,
  );

  if (!res.ok) {
    const msg = ebayErrorMessage(res.status, res.json, res.text);
    await supabase
      .from("marketplace_listings")
      .update({
        error_message: msg.slice(0, 2000),
        last_failed_step: "withdraw",
      })
      .eq("id", listing.id);
    return { ok: false, errorMessage: msg, raw: { status: res.status, json: res.json } };
  }

  await supabase
    .from("marketplace_listings")
    .update({
      status: "ended",
      error_message: null,
      last_failed_step: null,
      provider_metadata: {
        ...meta,
        endedAt: new Date().toISOString(),
        withdrawResponse: res.json ?? null,
      },
    })
    .eq("id", listing.id);

  return { ok: true, offerId, status: res.status, raw: res.json };
}

/**
 * Withdraw (end) an active eBay listing.
 * Calls POST /sell/inventory/v1/offer/{offerId}/withdraw — the listing is
 * ended on eBay but the offer and inventory item remain so it can be
 * republished later.
 */
export const endEbayListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<EndEbayListingDTO> => {
    return withdrawEbayListingForProduct(context.supabase, data.productId);
  });
