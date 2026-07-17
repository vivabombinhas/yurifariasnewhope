/**
 * Server-only helpers for merging Best Offer terms into an existing eBay Offer
 * without losing any other field. Used by publish flow and bulk-apply.
 */
import { getValidEbayAccessToken } from "./token-service.server";
import { ebayFetch, ebayErrorMessage } from "./draft.server";
import type { ResolvedBestOffer } from "./best-offer";

const MARKETPLACE_ID = "EBAY_US";
const CURRENCY = "USD";

function centsToAmount(cents: number) {
  return { value: (cents / 100).toFixed(2), currency: CURRENCY };
}

/** Build the bestOfferTerms fragment (or null when disabled). */
export function buildBestOfferTerms(resolved: ResolvedBestOffer): Record<string, unknown> {
  if (!resolved.enabled) return { bestOfferEnabled: false };
  const terms: Record<string, unknown> = { bestOfferEnabled: true };
  if (resolved.autoAcceptCents != null) {
    terms.autoAcceptPrice = centsToAmount(resolved.autoAcceptCents);
  }
  if (resolved.autoDeclineCents != null) {
    terms.autoDeclinePrice = centsToAmount(resolved.autoDeclineCents);
  }
  return terms;
}

/**
 * GET the offer, merge Best Offer into listingPolicies.bestOfferTerms while
 * preserving every other field, then PUT it back. Does not publish/withdraw.
 */
export async function applyBestOfferToOffer(
  offerId: string,
  resolved: ResolvedBestOffer,
): Promise<{ ok: true } | { ok: false; error: string; category?: "unsupported" | "generic" }> {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const token = await getValidEbayAccessToken();

  const getRes = await ebayFetch(
    env,
    "GET",
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    token,
  );
  if (!getRes.ok) {
    return {
      ok: false,
      error: `Read offer ${offerId}: ${ebayErrorMessage(getRes.status, getRes.json, getRes.text)}`,
    };
  }
  const offer = getRes.json ?? {};
  const listingPolicies = { ...(offer.listingPolicies ?? {}) };
  listingPolicies.bestOfferTerms = buildBestOfferTerms(resolved);

  const body: Record<string, unknown> = {
    sku: offer.sku,
    marketplaceId: offer.marketplaceId ?? MARKETPLACE_ID,
    format: offer.format ?? "FIXED_PRICE",
    availableQuantity: offer.availableQuantity ?? 1,
    categoryId: offer.categoryId,
    listingDescription: offer.listingDescription,
    pricingSummary: offer.pricingSummary,
    merchantLocationKey: offer.merchantLocationKey,
    listingPolicies,
  };
  // Preserve optional fields when present
  for (const k of ["tax", "storeCategoryNames", "listingStartDate", "quantityLimitPerBuyer"]) {
    if (offer[k] !== undefined) body[k] = offer[k];
  }

  const putRes = await ebayFetch(
    env,
    "PUT",
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    token,
    body,
  );
  if (!putRes.ok) {
    const msg = ebayErrorMessage(putRes.status, putRes.json, putRes.text);
    const category = /best.?offer/i.test(msg) && /(not|un)supported|invalid|allowed/i.test(msg)
      ? "unsupported"
      : "generic";
    return { ok: false, error: msg, category };
  }
  return { ok: true };
}
