/**
 * eBay Seller Setup (Sandbox Only).
 * Creates the minimum account-level resources required to publish:
 *   - Merchant Location
 *   - Fulfillment Policy
 *   - Payment Policy
 *   - Return Policy
 * Also supports syncing an existing unpublished Offer with these resources
 * so /publish becomes possible.
 *
 * Does NOT call /publish.
 */
import { getValidEbayAccessToken } from "./token-service.server";
import { ebayFetch, ebayErrorMessage } from "./draft.server";

const MARKETPLACE_ID = "EBAY_US";
const DEFAULT_LOCATION_KEY = "default_location";

export type SellerSetupKey =
  | "location"
  | "fulfillmentPolicy"
  | "paymentPolicy"
  | "returnPolicy";

export interface SellerSetupItem {
  key: SellerSetupKey;
  label: string;
  status: "exists" | "missing";
  id?: string;
  name?: string;
  count: number;
}

export interface SellerSetupStatus {
  ready: boolean;
  items: SellerSetupItem[];
  defaults: {
    merchantLocationKey?: string;
    fulfillmentPolicyId?: string;
    paymentPolicyId?: string;
    returnPolicyId?: string;
  };
}

async function ensureSandbox() {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  if (env !== "sandbox" && env !== "production") {
    throw new Error(`Unknown EBAY_ENV: ${env}`);
  }
  return env;
}

export async function inspectSellerSetup(): Promise<SellerSetupStatus> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const mq = `?marketplace_id=${MARKETPLACE_ID}`;

  const [locRes, fulRes, payRes, retRes] = await Promise.all([
    ebayFetch(env, "GET", `/sell/inventory/v1/location`, token),
    ebayFetch(env, "GET", `/sell/account/v1/fulfillment_policy${mq}`, token),
    ebayFetch(env, "GET", `/sell/account/v1/payment_policy${mq}`, token),
    ebayFetch(env, "GET", `/sell/account/v1/return_policy${mq}`, token),
  ]);

  const locations = (locRes.json?.locations ?? []) as any[];
  const fulfillment = (fulRes.json?.fulfillmentPolicies ?? []) as any[];
  const payment = (payRes.json?.paymentPolicies ?? []) as any[];
  const returns = (retRes.json?.returnPolicies ?? []) as any[];

  const items: SellerSetupItem[] = [
    {
      key: "location",
      label: "Merchant Location",
      status: locations.length ? "exists" : "missing",
      id: locations[0]?.merchantLocationKey,
      name: locations[0]?.name,
      count: locations.length,
    },
    {
      key: "fulfillmentPolicy",
      label: "Fulfillment Policy",
      status: fulfillment.length ? "exists" : "missing",
      id: fulfillment[0]?.fulfillmentPolicyId,
      name: fulfillment[0]?.name,
      count: fulfillment.length,
    },
    {
      key: "paymentPolicy",
      label: "Payment Policy",
      status: payment.length ? "exists" : "missing",
      id: payment[0]?.paymentPolicyId,
      name: payment[0]?.name,
      count: payment.length,
    },
    {
      key: "returnPolicy",
      label: "Return Policy",
      status: returns.length ? "exists" : "missing",
      id: returns[0]?.returnPolicyId,
      name: returns[0]?.name,
      count: returns.length,
    },
  ];

  return {
    ready: items.every((i) => i.status === "exists"),
    items,
    defaults: {
      merchantLocationKey: locations[0]?.merchantLocationKey,
      fulfillmentPolicyId: fulfillment[0]?.fulfillmentPolicyId,
      paymentPolicyId: payment[0]?.paymentPolicyId,
      returnPolicyId: returns[0]?.returnPolicyId,
    },
  };
}

export async function createSandboxLocation(): Promise<{ merchantLocationKey: string }> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const body = {
    location: {
      address: {
        country: "US",
        city: "San Jose",
        stateOrProvince: "CA",
        postalCode: "95125",
        addressLine1: "2025 Hamilton Ave",
      },
    },
    locationInstructions: "Items ship from here",
    name: "Default Location",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
  };
  const res = await ebayFetch(
    env,
    "POST",
    `/sell/inventory/v1/location/${DEFAULT_LOCATION_KEY}`,
    token,
    body,
  );
  // 204 on create, 409 if already exists — both acceptable
  if (!res.ok && res.status !== 409) {
    throw new Error(`Location: ${ebayErrorMessage(res.status, res.json, res.text)}`);
  }
  return { merchantLocationKey: DEFAULT_LOCATION_KEY };
}

function defaultFulfillmentPolicyBody() {
  return {
    name: "Default Fulfillment",
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
    handlingTime: { value: 1, unit: "DAY" },
    shippingOptions: [
      {
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            sortOrder: 1,
            shippingCarrierCode: "USPS",
            shippingServiceCode: "USPSPriority",
            shippingCost: { value: "5.00", currency: "USD" },
            freeShipping: false,
            buyerResponsibleForShipping: false,
          },
        ],
      },
    ],
  };
}

export async function createSandboxFulfillmentPolicy(): Promise<{ id: string }> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const res = await ebayFetch(
    env,
    "POST",
    `/sell/account/v1/fulfillment_policy`,
    token,
    defaultFulfillmentPolicyBody(),
  );
  if (!res.ok) {
    throw new Error(`Fulfillment policy: ${ebayErrorMessage(res.status, res.json, res.text)}`);
  }
  return { id: res.json?.fulfillmentPolicyId };
}

/**
 * Returns a Fulfillment Policy ID guaranteed to have at least one valid
 * domestic shipping service. Repairs the existing default policy in place
 * when it lacks shippingServices (eBay errorId 25007), or creates a fresh
 * one. Idempotent.
 */
export async function ensureValidFulfillmentPolicy(): Promise<{ id: string; repaired: boolean }> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const mq = `?marketplace_id=${MARKETPLACE_ID}`;
  const listRes = await ebayFetch(env, "GET", `/sell/account/v1/fulfillment_policy${mq}`, token);
  const policies = (listRes.json?.fulfillmentPolicies ?? []) as any[];

  const hasService = (p: any) =>
    Array.isArray(p?.shippingOptions) &&
    p.shippingOptions.some(
      (o: any) => Array.isArray(o?.shippingServices) && o.shippingServices.length > 0,
    );

  const valid = policies.find(hasService);
  if (valid) return { id: valid.fulfillmentPolicyId, repaired: false };

  // Repair the first existing policy (preserve its ID so the offer keeps working)
  const stale = policies[0];
  if (stale?.fulfillmentPolicyId) {
    const putRes = await ebayFetch(
      env,
      "PUT",
      `/sell/account/v1/fulfillment_policy/${encodeURIComponent(stale.fulfillmentPolicyId)}`,
      token,
      { ...defaultFulfillmentPolicyBody(), name: stale.name ?? "Default Fulfillment" },
    );
    if (!putRes.ok) {
      throw new Error(
        `Repair fulfillment policy: ${ebayErrorMessage(putRes.status, putRes.json, putRes.text)}`,
      );
    }
    return { id: stale.fulfillmentPolicyId, repaired: true };
  }

  // No policy at all — create one
  const created = await createSandboxFulfillmentPolicy();
  return { id: created.id, repaired: true };
}

export async function createSandboxPaymentPolicy(): Promise<{ id: string }> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const body = {
    name: "Default Payment",
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
    immediatePay: true,
    paymentMethods: [],
  };
  const res = await ebayFetch(env, "POST", `/sell/account/v1/payment_policy`, token, body);
  if (!res.ok) {
    throw new Error(`Payment policy: ${ebayErrorMessage(res.status, res.json, res.text)}`);
  }
  return { id: res.json?.paymentPolicyId };
}

export async function createSandboxReturnPolicy(): Promise<{ id: string }> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const body = {
    name: "Default Return",
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    refundMethod: "MONEY_BACK",
    returnShippingCostPayer: "BUYER",
  };
  const res = await ebayFetch(env, "POST", `/sell/account/v1/return_policy`, token, body);
  if (!res.ok) {
    throw new Error(`Return policy: ${ebayErrorMessage(res.status, res.json, res.text)}`);
  }
  return { id: res.json?.returnPolicyId };
}

/**
 * Update an existing unpublished Offer with the seller-setup defaults so
 * preflight flips to Ready. Fetches the offer, merges merchantLocationKey
 * + listingPolicies, and PUTs the full body back.
 */
export async function syncOfferWithSellerSetup(offerId: string): Promise<{
  ok: true;
  applied: {
    merchantLocationKey?: string;
    fulfillmentPolicyId?: string;
    paymentPolicyId?: string;
    returnPolicyId?: string;
  };
}> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const status = await inspectSellerSetup();
  const d = status.defaults;
  if (!d.merchantLocationKey || !d.fulfillmentPolicyId || !d.paymentPolicyId || !d.returnPolicyId) {
    throw new Error("Seller setup incomplete; create all four resources first.");
  }

  // Ensure the Fulfillment Policy actually has a shipping service (eBay errorId 25007 guard)
  const fulfillment = await ensureValidFulfillmentPolicy();
  d.fulfillmentPolicyId = fulfillment.id;

  // Fetch existing offer
  const offerRes = await ebayFetch(
    env,
    "GET",
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    token,
  );
  if (!offerRes.ok) {
    throw new Error(`Read offer: ${ebayErrorMessage(offerRes.status, offerRes.json, offerRes.text)}`);
  }
  const offer = offerRes.json ?? {};

  // Build updatable body (Sell Inventory PUT /offer/{offerId} requires full body)
  const body: any = {
    sku: offer.sku,
    marketplaceId: offer.marketplaceId ?? MARKETPLACE_ID,
    format: offer.format ?? "FIXED_PRICE",
    availableQuantity: offer.availableQuantity ?? 1,
    categoryId: offer.categoryId,
    listingDescription: offer.listingDescription,
    pricingSummary: offer.pricingSummary,
    merchantLocationKey: d.merchantLocationKey,
    listingPolicies: {
      fulfillmentPolicyId: d.fulfillmentPolicyId,
      paymentPolicyId: d.paymentPolicyId,
      returnPolicyId: d.returnPolicyId,
    },
  };

  const putRes = await ebayFetch(
    env,
    "PUT",
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    token,
    body,
  );
  if (!putRes.ok) {
    throw new Error(`Update offer: ${ebayErrorMessage(putRes.status, putRes.json, putRes.text)}`);
  }

  return {
    ok: true,
    applied: {
      merchantLocationKey: d.merchantLocationKey,
      fulfillmentPolicyId: d.fulfillmentPolicyId,
      paymentPolicyId: d.paymentPolicyId,
      returnPolicyId: d.returnPolicyId,
    },
  };
}

// ===== Business Policies opt-in (SELLING_POLICY_MANAGEMENT) =====

export interface OptInStatus {
  optedIn: boolean;
  programs: string[];
  raw: unknown;
}

export async function getOptedInPrograms(): Promise<OptInStatus> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const res = await ebayFetch(env, "GET", `/sell/account/v1/program/get_opted_in_programs`, token);
  if (!res.ok) {
    throw new Error(
      `getOptedInPrograms: ${ebayErrorMessage(res.status, res.json, res.text)} :: ${JSON.stringify(res.json ?? res.text)}`,
    );
  }
  const programs: string[] = (res.json?.programs ?? []).map((p: any) => p.programType);
  return {
    optedIn: programs.includes("SELLING_POLICY_MANAGEMENT"),
    programs,
    raw: res.json,
  };
}

export async function optInToBusinessPolicies(): Promise<{ ok: true; raw: unknown } | { ok: false; status: number; raw: unknown }> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const res = await ebayFetch(
    env,
    "POST",
    `/sell/account/v1/program/opt_in`,
    token,
    { programType: "SELLING_POLICY_MANAGEMENT" },
  );
  // 200/204 ok; some accounts return 409 if already opted in
  if (!res.ok && res.status !== 409) {
    return { ok: false, status: res.status, raw: res.json ?? res.text };
  }
  return { ok: true, raw: res.json ?? res.text ?? null };
}

// ===== Merchant Location validation =====

export interface ValidMerchantLocation {
  merchantLocationKey: string;
  status: string;
  country: string;
  postalCode?: string;
  city?: string;
  stateOrProvince?: string;
  created: boolean;
}

interface MinimalSupabase {
  from: (table: string) => any;
}

function locationIsValid(loc: any, expectedCountry: string) {
  const status = loc?.merchantLocationStatus;
  const addr = loc?.location?.address ?? {};
  const country = addr.country;
  const postalCode = addr.postalCode;
  const city = addr.city;
  const state = addr.stateOrProvince;
  if (status !== "ENABLED") return false;
  if (!country || country !== expectedCountry) return false;
  if (!postalCode && !(city && state)) return false;
  return true;
}

async function fetchLocation(env: string, token: string, key: string) {
  return ebayFetch(
    env,
    "GET",
    `/sell/inventory/v1/location/${encodeURIComponent(key)}`,
    token,
  );
}

/**
 * Ensure the eBay account has a valid Inventory Location for EBAY_US.
 * - Validates the currently-saved merchantLocationKey
 * - Falls back to scanning all locations
 * - If none are valid, creates a fresh location with a new key and persists it
 * - Throws INVALID_MERCHANT_LOCATION if even the new one is not valid
 */
export async function ensureValidMerchantLocation(
  supabase: MinimalSupabase,
): Promise<ValidMerchantLocation> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const expectedCountry = "US";

  const { data: account, error: accErr } = await supabase
    .from("marketplace_accounts")
    .select("id, merchant_location_key")
    .eq("marketplace", "ebay")
    .maybeSingle();
  if (accErr) throw accErr;

  // Try saved key first
  let candidate: { key: string; loc: any } | null = null;
  if (account?.merchant_location_key) {
    const r = await fetchLocation(env, token, account.merchant_location_key);
    if (r.ok && r.json) candidate = { key: account.merchant_location_key, loc: r.json };
  }

  // Then scan all locations
  if (!candidate || !locationIsValid(candidate.loc, expectedCountry)) {
    const listRes = await ebayFetch(env, "GET", `/sell/inventory/v1/location`, token);
    const locations = (listRes.json?.locations ?? []) as any[];
    const found = locations.find((l) => locationIsValid(l, expectedCountry));
    if (found) candidate = { key: found.merchantLocationKey, loc: found };
  }

  // Still nothing — create a fresh location with a new key
  if (!candidate || !locationIsValid(candidate.loc, expectedCountry)) {
    const newKey = `loc_${Date.now()}`;
    const body = {
      location: {
        address: {
          country: "US",
          city: "San Jose",
          stateOrProvince: "CA",
          postalCode: "95125",
          addressLine1: "2025 Hamilton Ave",
        },
      },
      locationInstructions: "Items ship from here",
      name: "Default Warehouse",
      merchantLocationStatus: "ENABLED",
      locationTypes: ["WAREHOUSE"],
    };
    const createRes = await ebayFetch(
      env,
      "POST",
      `/sell/inventory/v1/location/${encodeURIComponent(newKey)}`,
      token,
      body,
    );
    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(
        `INVALID_MERCHANT_LOCATION: failed to create location ${newKey}: ${ebayErrorMessage(createRes.status, createRes.json, createRes.text)}`,
      );
    }
    // Ensure enabled (best-effort)
    await ebayFetch(
      env,
      "POST",
      `/sell/inventory/v1/location/${encodeURIComponent(newKey)}/enable`,
      token,
    );
    const verify = await fetchLocation(env, token, newKey);
    if (!verify.ok || !verify.json || !locationIsValid(verify.json, expectedCountry)) {
      const addr = verify.json?.location?.address ?? {};
      throw new Error(
        `INVALID_MERCHANT_LOCATION: ${JSON.stringify({
          merchantLocationKey: newKey,
          status: verify.json?.merchantLocationStatus,
          country: addr.country,
          postalCode: addr.postalCode,
          city: addr.city,
          stateOrProvince: addr.stateOrProvince,
        })}`,
      );
    }
    candidate = { key: newKey, loc: verify.json };

    // Persist new key
    const { error: upErr } = await supabase
      .from("marketplace_accounts")
      .update({ merchant_location_key: newKey })
      .eq("marketplace", "ebay");
    if (upErr) throw upErr;

    const addr = verify.json.location?.address ?? {};
    return {
      merchantLocationKey: newKey,
      status: verify.json.merchantLocationStatus,
      country: addr.country,
      postalCode: addr.postalCode,
      city: addr.city,
      stateOrProvince: addr.stateOrProvince,
      created: true,
    };
  }

  // Persist saved key if it differs from current account row
  if (account?.merchant_location_key !== candidate.key) {
    await supabase
      .from("marketplace_accounts")
      .update({ merchant_location_key: candidate.key })
      .eq("marketplace", "ebay");
  }

  const addr = candidate.loc.location?.address ?? candidate.loc.address ?? {};
  return {
    merchantLocationKey: candidate.key,
    status: candidate.loc.merchantLocationStatus,
    country: addr.country,
    postalCode: addr.postalCode,
    city: addr.city,
    stateOrProvince: addr.stateOrProvince,
    created: false,
  };
}

/**
 * Patch only merchantLocationKey on an existing unpublished Offer,
 * preserving every other field eBay's PUT requires.
 */
export async function setOfferMerchantLocation(
  offerId: string,
  merchantLocationKey: string,
): Promise<void> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();

  const offerRes = await ebayFetch(
    env,
    "GET",
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    token,
  );
  if (!offerRes.ok) {
    throw new Error(`Read offer: ${ebayErrorMessage(offerRes.status, offerRes.json, offerRes.text)}`);
  }
  const offer = offerRes.json ?? {};
  if (offer.merchantLocationKey === merchantLocationKey) return;

  const body: any = {
    sku: offer.sku,
    marketplaceId: offer.marketplaceId ?? MARKETPLACE_ID,
    format: offer.format ?? "FIXED_PRICE",
    availableQuantity: offer.availableQuantity ?? 1,
    categoryId: offer.categoryId,
    listingDescription: offer.listingDescription,
    pricingSummary: offer.pricingSummary,
    merchantLocationKey,
    listingPolicies: offer.listingPolicies,
  };

  const putRes = await ebayFetch(
    env,
    "PUT",
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    token,
    body,
  );
  if (!putRes.ok) {
    throw new Error(`Update offer location: ${ebayErrorMessage(putRes.status, putRes.json, putRes.text)}`);
  }
}
