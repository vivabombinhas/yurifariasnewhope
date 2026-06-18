/**
 * Calls eBay Sandbox /sell/inventory/v1/offer/{offerId}/publish
 * and returns the raw response. Does NOT touch Draft / Seller Setup / Policies.
 */
import { getValidEbayAccessToken } from "./token-service.server";
import { ebayFetch, ebayErrorMessage } from "./draft.server";

export interface EbayPublishRaw {
  status: number;
  json: any;
  text: string;
}

export interface EbayPublishOk {
  ok: true;
  listingId: string;
  raw: EbayPublishRaw;
}

export interface EbayPublishErr {
  ok: false;
  errorMessage: string;
  errors: Array<{
    errorId?: number;
    domain?: string;
    category?: string;
    message?: string;
    longMessage?: string;
  }>;
  raw: EbayPublishRaw;
}

export type EbayPublishResult = EbayPublishOk | EbayPublishErr;

export async function publishOffer(offerId: string): Promise<EbayPublishResult> {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const token = await getValidEbayAccessToken();

  const res = await ebayFetch(
    env,
    "POST",
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    token,
  );

  const raw: EbayPublishRaw = { status: res.status, json: res.json, text: res.text };

  if (res.ok && res.json?.listingId) {
    return { ok: true, listingId: String(res.json.listingId), raw };
  }

  const errors = (res.json?.errors ?? []).map((e: any) => ({
    errorId: e.errorId,
    domain: e.domain,
    category: e.category,
    message: e.message,
    longMessage: e.longMessage,
  }));

  return {
    ok: false,
    errorMessage: ebayErrorMessage(res.status, res.json, res.text),
    errors,
    raw,
  };
}
