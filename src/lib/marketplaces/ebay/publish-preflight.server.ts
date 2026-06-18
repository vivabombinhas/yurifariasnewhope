/**
 * Read an unpublished eBay Offer and inspect the dependencies required
 * before /publish can succeed. Does NOT call /publish.
 */
import { getValidEbayAccessToken } from "./token-service.server";
import { ebayFetch, ebayErrorMessage } from "./draft.server";

const MARKETPLACE_ID = "EBAY_US";

export interface PreflightCheck {
  key:
    | "offer"
    | "merchantLocationKey"
    | "fulfillmentPolicyId"
    | "paymentPolicyId"
    | "returnPolicyId";
  label: string;
  status: "ok" | "missing" | "error";
  detail?: string;
}

export interface PreflightResult {
  offerId: string;
  ready: boolean;
  offerStatus?: string;
  listingPolicies?: {
    fulfillmentPolicyId?: string;
    paymentPolicyId?: string;
    returnPolicyId?: string;
  };
  merchantLocationKey?: string;
  available: {
    locations: Array<{ merchantLocationKey: string; name?: string }>;
    fulfillmentPolicies: Array<{ id: string; name?: string }>;
    paymentPolicies: Array<{ id: string; name?: string }>;
    returnPolicies: Array<{ id: string; name?: string }>;
  };
  checks: PreflightCheck[];
  error?: string;
}

export async function inspectOfferForPublish(offerId: string): Promise<PreflightResult> {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const token = await getValidEbayAccessToken();

  const empty: PreflightResult["available"] = {
    locations: [],
    fulfillmentPolicies: [],
    paymentPolicies: [],
    returnPolicies: [],
  };

  // 1. Get offer
  const offerRes = await ebayFetch(
    env,
    "GET",
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    token,
  );
  if (!offerRes.ok) {
    return {
      offerId,
      ready: false,
      available: empty,
      checks: [
        {
          key: "offer",
          label: "Offer readable",
          status: "error",
          detail: ebayErrorMessage(offerRes.status, offerRes.json, offerRes.text),
        },
      ],
      error: ebayErrorMessage(offerRes.status, offerRes.json, offerRes.text),
    };
  }

  const offer = offerRes.json ?? {};
  const merchantLocationKey: string | undefined = offer.merchantLocationKey;
  const listingPolicies = offer.listingPolicies ?? {};

  // 2. Fetch available locations + policies in parallel (best-effort)
  const mq = `?marketplace_id=${MARKETPLACE_ID}`;
  const [locRes, fulRes, payRes, retRes] = await Promise.all([
    ebayFetch(env, "GET", `/sell/inventory/v1/location`, token),
    ebayFetch(env, "GET", `/sell/account/v1/fulfillment_policy${mq}`, token),
    ebayFetch(env, "GET", `/sell/account/v1/payment_policy${mq}`, token),
    ebayFetch(env, "GET", `/sell/account/v1/return_policy${mq}`, token),
  ]);

  const available: PreflightResult["available"] = {
    locations: (locRes.json?.locations ?? []).map((l: any) => ({
      merchantLocationKey: l.merchantLocationKey,
      name: l.name,
    })),
    fulfillmentPolicies: (fulRes.json?.fulfillmentPolicies ?? []).map((p: any) => ({
      id: p.fulfillmentPolicyId,
      name: p.name,
    })),
    paymentPolicies: (payRes.json?.paymentPolicies ?? []).map((p: any) => ({
      id: p.paymentPolicyId,
      name: p.name,
    })),
    returnPolicies: (retRes.json?.returnPolicies ?? []).map((p: any) => ({
      id: p.returnPolicyId,
      name: p.name,
    })),
  };

  const checks: PreflightCheck[] = [
    { key: "offer", label: "Offer readable", status: "ok" },
    {
      key: "merchantLocationKey",
      label: "Merchant location",
      status: merchantLocationKey ? "ok" : "missing",
      detail: merchantLocationKey
        ? merchantLocationKey
        : available.locations.length
          ? `${available.locations.length} location(s) available — set on offer`
          : "No locations configured on the eBay account",
    },
    {
      key: "fulfillmentPolicyId",
      label: "Fulfillment policy",
      status: listingPolicies.fulfillmentPolicyId ? "ok" : "missing",
      detail:
        listingPolicies.fulfillmentPolicyId ??
        (available.fulfillmentPolicies.length
          ? `${available.fulfillmentPolicies.length} policy(ies) available — set on offer`
          : "No fulfillment policies configured"),
    },
    {
      key: "paymentPolicyId",
      label: "Payment policy",
      status: listingPolicies.paymentPolicyId ? "ok" : "missing",
      detail:
        listingPolicies.paymentPolicyId ??
        (available.paymentPolicies.length
          ? `${available.paymentPolicies.length} policy(ies) available — set on offer`
          : "No payment policies configured"),
    },
    {
      key: "returnPolicyId",
      label: "Return policy",
      status: listingPolicies.returnPolicyId ? "ok" : "missing",
      detail:
        listingPolicies.returnPolicyId ??
        (available.returnPolicies.length
          ? `${available.returnPolicies.length} policy(ies) available — set on offer`
          : "No return policies configured"),
    },
  ];

  const ready = checks.every((c) => c.status === "ok");

  return {
    offerId,
    ready,
    offerStatus: offer.status,
    listingPolicies: {
      fulfillmentPolicyId: listingPolicies.fulfillmentPolicyId,
      paymentPolicyId: listingPolicies.paymentPolicyId,
      returnPolicyId: listingPolicies.returnPolicyId,
    },
    merchantLocationKey,
    available,
    checks,
  };
}
