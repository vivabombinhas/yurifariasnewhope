/**
 * eBay Sell Inventory API — create InventoryItem + unpublished Offer.
 * SANDBOX ONLY. Does NOT call /publish.
 */
import { getValidEbayAccessToken } from "./token-service.server";
import { assertConditionIdEnumMatch, getEbayConditionPolicies } from "./condition-policies.server";

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
  productId?: string;
  publishAttemptId?: string;
  sku: string;
  title: string;
  description: string;
  priceCents: number;
  internalCondition: string | null;
  ebayConditionId: number;
  ebayConditionEnum: string;
  ebayConditionName: string;
  categoryId: string;
  aspects: unknown;
  imageUrls: string[];
}

export interface CreateDraftResult {
  sku: string;
  offerId: string;
  inventoryItem: unknown;
  inventoryItemGet: unknown;
  offer: unknown;
  conditionVerification: EbayInventoryConditionVerification;
}

export interface EbayInventoryConditionVerification {
  internalCondition: string | null;
  ebayCategoryId: string;
  selectedEbayConditionId: number;
  selectedEbayConditionName: string;
  selectedEbayConditionEnum: string;
  putSentCondition: string;
  getReturnedCondition: string | null;
  offerId?: string;
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

function apiUrl(env: string, path: string) {
  return `${apiHost(env)}${path}`;
}

async function ebayFetchWithDiagnostics(
  env: string,
  method: string,
  path: string,
  token: string,
  body: unknown,
) {
  const serializedBody = body == null ? undefined : JSON.stringify(body);
  const res = await ebayFetch(env, method, path, token, body);
  return {
    res,
    diagnostics: {
      url: apiUrl(env, path),
      env,
      method,
      skuInUrl: decodeURIComponent(path.split("/").pop() ?? ""),
      requestHeaders: {
        "Content-Type": "application/json",
        "Content-Language": HTTP_LOCALE,
      },
      requestBody: serializedBody ? JSON.parse(serializedBody) : null,
      responseStatus: res.status,
      response: { ok: res.ok, status: res.status, json: res.json, text: res.text },
    },
  };
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

async function assertSelectedConditionAllowed(input: CreateDraftInput) {
  assertConditionIdEnumMatch(input.ebayConditionId, input.ebayConditionEnum);
  const policies = await getEbayConditionPolicies(input.categoryId);
  const selected = policies.find(
    (p) =>
      p.conditionId === input.ebayConditionId &&
      p.conditionEnum === input.ebayConditionEnum,
  );
  if (!selected) {
    throw new Error(
      JSON.stringify({
        code: "INVALID_EBAY_CONDITION_FOR_CATEGORY",
        message: "Selected eBay Condition is not valid for the current category.",
        internalCondition: input.internalCondition,
        ebayCategoryId: input.categoryId,
        selectedEbayConditionId: input.ebayConditionId,
        selectedEbayConditionName: input.ebayConditionName,
        selectedEbayConditionEnum: input.ebayConditionEnum,
        allowedConditions: policies.map((p) => ({
          conditionId: p.conditionId,
          conditionName: p.displayName,
          conditionEnum: p.conditionEnum,
        })),
      }),
    );
  }
  return selected;
}

export async function verifyInventoryItemCondition(
  env: string,
  token: string,
  input: CreateDraftInput,
): Promise<{ inventoryItemGet: unknown; verification: EbayInventoryConditionVerification }> {
  const getRes = await ebayFetch(
    env,
    "GET",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`,
    token,
  );
  if (!getRes.ok) {
    throw new Error(`InventoryItem GET: ${ebayErrorMessage(getRes.status, getRes.json, getRes.text)}`);
  }

  const getReturnedCondition =
    typeof getRes.json?.condition === "string" ? getRes.json.condition : null;
  const verification: EbayInventoryConditionVerification = {
    internalCondition: input.internalCondition,
    ebayCategoryId: input.categoryId,
    selectedEbayConditionId: input.ebayConditionId,
    selectedEbayConditionName: input.ebayConditionName,
    selectedEbayConditionEnum: input.ebayConditionEnum,
    putSentCondition: input.ebayConditionEnum,
    getReturnedCondition,
  };

  if (getReturnedCondition !== input.ebayConditionEnum) {
    throw new Error(
      JSON.stringify({
        code: "INVENTORY_CONDITION_DRIFT",
        message: "eBay stored a different InventoryItem condition than the one sent. Offer/Publish blocked.",
        ...verification,
      }),
    );
  }

  return { inventoryItemGet: getRes.json, verification };
}

export async function verifyEbayInventoryItemCondition(input: CreateDraftInput) {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const token = await getValidEbayAccessToken();
  await assertSelectedConditionAllowed(input);
  return verifyInventoryItemCondition(env, token, input);
}

export async function createEbayDraftInSandbox(
  input: CreateDraftInput,
): Promise<CreateDraftResult> {
  const publishAttemptId = input.publishAttemptId ?? crypto.randomUUID();
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  if (env !== "sandbox") {
    throw new Error("Draft creation is restricted to sandbox environment.");
  }
  if (!input.ebayConditionEnum || !input.ebayConditionId || !input.ebayConditionName) {
    throw new Error("Select a valid eBay Condition before creating the draft.");
  }

  const token = await getValidEbayAccessToken();
  await assertSelectedConditionAllowed(input);

  // 0. Clean up any stale Offer/InventoryItem for this SKU so we always send
  //    a fresh InventoryItem with the current condition. eBay caches the
  //    InventoryItem server-side; if a prior Offer references an inventory
  //    item with an outdated condition, Publish will keep failing.
  const existingOffersRes = await ebayFetch(
    env,
    "GET",
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(input.sku)}`,
    token,
  );
  if (!existingOffersRes.ok) {
    throw new Error(`List existing offers: ${ebayErrorMessage(existingOffersRes.status, existingOffersRes.json, existingOffersRes.text)}`);
  }
  const existingOffers: any[] = existingOffersRes.json?.offers ?? [];
  for (const off of existingOffers) {
    if (!off?.offerId) continue;
    const offerStatus = String(off.status ?? "").toUpperCase();
    const maybePublished =
      offerStatus === "PUBLISHED" ||
      !!off.listing?.listingId ||
      !!off.listingId;
    if (maybePublished) {
      console.warn("[createEbayDraft] skipped published offer cleanup", {
        offerId: off.offerId,
        status: off.status,
        listingId: off.listing?.listingId ?? off.listingId,
      });
      throw new Error(
        `Existing eBay offer ${off.offerId} appears published. Refusing to overwrite inventory item ${input.sku} without an explicit active-listing workflow.`,
      );
    }
    if (offerStatus !== "UNPUBLISHED") {
      throw new Error(
        `Existing eBay offer ${off.offerId} has status ${off.status ?? "unknown"}. Only UNPUBLISHED offers may be removed automatically.`,
      );
    }
    const del = await ebayFetch(
      env,
      "DELETE",
      `/sell/inventory/v1/offer/${encodeURIComponent(off.offerId)}`,
      token,
    );
    console.log("[createEbayDraft] deleted stale offer", {
      offerId: off.offerId,
      status: del.status,
    });
    if (!del.ok) {
      throw new Error(`Delete stale offer ${off.offerId}: ${ebayErrorMessage(del.status, del.json, del.text)}`);
    }
  }

  // 1. PUT InventoryItem (fully replaces existing inventory item for this SKU)
  const inventoryBody = {
    availability: {
      shipToLocationAvailability: { quantity: 1 },
    },
    condition: input.ebayConditionEnum,
    product: {
      title: input.title.slice(0, 80),
      description: input.description,
      aspects: aspectsForApi(input.aspects),
      imageUrls: input.imageUrls,
    },
  };

  console.log("[createEbayDraft] PUT inventory_item", {
    publishAttemptId,
    productId: input.productId,
    sku: input.sku,
    url: apiUrl(env, `/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`),
    env,
    internalCondition: input.internalCondition,
    ebayCategoryId: input.categoryId,
    selectedEbayConditionId: input.ebayConditionId,
    selectedEbayConditionName: input.ebayConditionName,
    selectedEbayConditionEnum: input.ebayConditionEnum,
    putSentCondition: input.ebayConditionEnum,
    imageCount: input.imageUrls.length,
  });
  const { res: invRes, diagnostics: putDiagnostics } = await ebayFetchWithDiagnostics(
    env,
    "PUT",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`,
    token,
    inventoryBody,
  );
  console.log("[createEbayDraft] PUT inventory_item HTTP diagnostics", {
    publishAttemptId,
    productId: input.productId,
    accountUser: "see marketplace_accounts.external_account_id in DB audit",
    ...putDiagnostics,
  });
  if (!invRes.ok) {
    throw new Error(`InventoryItem: ${ebayErrorMessage(invRes.status, invRes.json, invRes.text)}`);
  }
  console.log("[createEbayDraft] inventory item upserted", {
    sku: input.sku,
    status: invRes.status,
    ebayConditionEnum: input.ebayConditionEnum,
  });

  const { inventoryItemGet, verification } = await verifyInventoryItemCondition(env, token, input);
  console.log("[createEbayDraft] inventory condition verified", verification);

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

  console.log("[createEbayDraft] POST offer", {
    sku: input.sku,
    categoryId: input.categoryId,
    ebayConditionEnum: input.ebayConditionEnum,
  });
  const offerRes = await ebayFetch(env, "POST", `/sell/inventory/v1/offer`, token, offerBody);
  if (!offerRes.ok) {
    throw new Error(`Offer: ${ebayErrorMessage(offerRes.status, offerRes.json, offerRes.text)}`);
  }
  const offerId: string | undefined = offerRes.json?.offerId;
  if (!offerId) throw new Error("Offer created but no offerId returned");
  console.log("[createEbayDraft] offer created (fresh)", {
    sku: input.sku,
    offerId,
    categoryId: input.categoryId,
    ebayConditionEnum: input.ebayConditionEnum,
  });
  const conditionVerification = { ...verification, offerId };
  console.log("[createEbayDraft] condition publish diagnostics", conditionVerification);

  return {
    sku: input.sku,
    offerId,
    inventoryItem: inventoryBody,
    inventoryItemGet,
    offer: offerRes.json,
    conditionVerification,
  };
}
