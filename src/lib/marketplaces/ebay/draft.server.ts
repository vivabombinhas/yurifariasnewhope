/**
 * eBay Sell Inventory API — create InventoryItem + unpublished Offer.
 * SANDBOX ONLY. Does NOT call /publish.
 */
import { getValidEbayAccessToken } from "./token-service.server";

const CONDITION_MAP: Record<string, string> = {
  new: "NEW",
  like_new: "LIKE_NEW",
  very_good: "USED_VERY_GOOD",
  good: "USED_GOOD",
  acceptable: "USED_ACCEPTABLE",
  for_parts: "FOR_PARTS_OR_NOT_WORKING",
};

const MARKETPLACE_ID = "EBAY_US";
const LOCALE = "en_US"; // body locale (eBay InventoryItem uses underscore form)
const HTTP_LOCALE = "en-US"; // HTTP headers require BCP-47 hyphen form
const CURRENCY = "USD";

function apiHost(env: string) {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

function aspectsForApi(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const arr = Array.isArray(v)
      ? v.map((x) => String(x))
      : v == null
        ? []
        : [String(v)];
    const filtered = arr.map((s) => s.trim()).filter(Boolean);
    if (filtered.length) out[k] = filtered;
  }
  return out;
}

export interface CreateDraftInput {
  sku: string;
  title: string;
  description: string;
  priceCents: number;
  condition: string; // product_condition enum
  categoryId: string;
  aspects: unknown;
  imageUrls: string[];
}

export interface CreateDraftResult {
  sku: string;
  offerId: string;
  inventoryItem: unknown;
  offer: unknown;
}

export async function ebayFetch(
  env: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; text: string; json: any | null }> {
  const res = await fetch(`${apiHost(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Language": HTTP_LOCALE,
      "Accept-Language": HTTP_LOCALE,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  return { ok: res.ok, status: res.status, text, json };
}

export function ebayErrorMessage(status: number, json: any, text: string): string {
  const errs = json?.errors;
  if (Array.isArray(errs) && errs.length) {
    return errs
      .map((e: any) => `${e.errorId ?? ""} ${e.message ?? ""} ${e.longMessage ?? ""}`.trim())
      .join(" | ");
  }
  return `eBay ${status}: ${text.slice(0, 500)}`;
}

export async function createEbayDraftInSandbox(
  input: CreateDraftInput,
): Promise<CreateDraftResult> {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  if (env !== "sandbox") {
    throw new Error("Draft creation is restricted to sandbox environment.");
  }
  const ebayCondition = CONDITION_MAP[input.condition];
  if (!ebayCondition) throw new Error(`Unmapped product condition: ${input.condition}`);

  const token = await getValidEbayAccessToken();

  // 1. PUT InventoryItem
  const inventoryBody = {
    availability: {
      shipToLocationAvailability: { quantity: 1 },
    },
    condition: ebayCondition,
    product: {
      title: input.title.slice(0, 80),
      description: input.description,
      aspects: aspectsForApi(input.aspects),
      imageUrls: input.imageUrls,
    },
  };

  console.log("[createEbayDraft] calling eBay InventoryItem", { sku: input.sku, env });
  const invRes = await ebayFetch(
    env,
    "PUT",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`,
    token,
    inventoryBody,
  );
  if (!invRes.ok) {
    throw new Error(`InventoryItem: ${ebayErrorMessage(invRes.status, invRes.json, invRes.text)}`);
  }
  console.log("[createEbayDraft] inventory item created", { sku: input.sku, status: invRes.status });

  // 2. POST Offer (UNPUBLISHED — do NOT call /publish)
  const offerBody = {
    sku: input.sku,
    marketplaceId: MARKETPLACE_ID,
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: input.categoryId,
    listingDescription: input.description,
    pricingSummary: {
      price: {
        value: (input.priceCents / 100).toFixed(2),
        currency: CURRENCY,
      },
    },
  };

  console.log("[createEbayDraft] calling eBay Offer", { sku: input.sku, categoryId: input.categoryId });
  const offerRes = await ebayFetch(env, "POST", `/sell/inventory/v1/offer`, token, offerBody);
  if (!offerRes.ok) {
    throw new Error(`Offer: ${ebayErrorMessage(offerRes.status, offerRes.json, offerRes.text)}`);
  }
  const offerId: string | undefined = offerRes.json?.offerId;
  if (!offerId) throw new Error("Offer created but no offerId returned");

  return {
    sku: input.sku,
    offerId,
    inventoryItem: inventoryBody,
    offer: offerRes.json,
  };
}
