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
  if (env !== "sandbox") {
    throw new Error("Seller setup is restricted to sandbox.");
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

export async function createSandboxFulfillmentPolicy(): Promise<{ id: string }> {
  const env = await ensureSandbox();
  const token = await getValidEbayAccessToken();
  const body = {
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
  const res = await ebayFetch(env, "POST", `/sell/account/v1/fulfillment_policy`, token, body);
  if (!res.ok) {
    throw new Error(`Fulfillment policy: ${ebayErrorMessage(res.status, res.json, res.text)}`);
  }
  return { id: res.json?.fulfillmentPolicyId };
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
