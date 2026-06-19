import { conditionEnumForPolicy } from "./condition-policies.server";
import { ebayFetch } from "./draft.server";
import { getValidEbayAccessToken } from "./token-service.server";

function apiHost(env: string) {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

function rawResponse(res: { ok: boolean; status: number; text: string; json: any | null }) {
  return {
    ok: res.ok,
    status: res.status,
    json: res.json,
    text: res.text,
  };
}

export interface EbayAuditConditionPolicyRow {
  conditionId: number;
  conditionDisplayName: string | null;
  conditionEnum: string;
}

export async function readEbayPublishAuditResources(input: {
  sku: string;
  offerId: string | null;
}) {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const token = await getValidEbayAccessToken();

  const inventoryItemRes = await ebayFetch(
    env,
    "GET",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`,
    token,
  );

  const offersForSkuRes = await ebayFetch(
    env,
    "GET",
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(input.sku)}`,
    token,
  );

  const offerRes = input.offerId
    ? await ebayFetch(
        env,
        "GET",
        `/sell/inventory/v1/offer/${encodeURIComponent(input.offerId)}`,
        token,
      )
    : null;

  const offerJson = offerRes?.json ?? null;
  const offerMarketplaceId =
    typeof offerJson?.marketplaceId === "string" ? offerJson.marketplaceId : null;
  const offerCategoryId =
    offerJson?.categoryId == null ? null : String(offerJson.categoryId);

  let conditionPoliciesRaw: ReturnType<typeof rawResponse> | null = null;
  let conditionPoliciesTable: EbayAuditConditionPolicyRow[] = [];

  if (offerMarketplaceId && offerCategoryId) {
    const params = new URLSearchParams({ filter: `categoryIds:{${offerCategoryId}}` });
    const res = await fetch(
      `${apiHost(env)}/sell/metadata/v1/marketplace/${encodeURIComponent(
        offerMarketplaceId,
      )}/get_item_condition_policies?${params}`,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": offerMarketplaceId,
          Accept: "application/json",
        },
      },
    );
    const text = await res.text();
    let json: any | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    conditionPoliciesRaw = { ok: res.ok, status: res.status, json, text };

    const policy =
      (json?.itemConditionPolicies ?? []).find(
        (p: any) => String(p?.categoryId) === offerCategoryId,
      ) ?? json?.itemConditionPolicies?.[0];
    conditionPoliciesTable = (policy?.itemConditions ?? []).map((c: any) => {
      const conditionId = Number(c.conditionId);
      const conditionDisplayName =
        typeof c.conditionDescription === "string" ? c.conditionDescription : null;
      return {
        conditionId,
        conditionDisplayName,
        conditionEnum: conditionEnumForPolicy(conditionId, conditionDisplayName ?? ""),
      };
    });
  }

  return {
    env,
    inventoryItemRaw: rawResponse(inventoryItemRes),
    offerRaw: offerRes ? rawResponse(offerRes) : null,
    offersForSkuRaw: rawResponse(offersForSkuRes),
    conditionPoliciesRaw,
    conditionPoliciesTable,
  };
}