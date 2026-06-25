/**
 * eBay Shipping Origin (Inventory Location).
 * SERVER ONLY. View + edit the merchant location used for shipping origin.
 */
import { getValidEbayAccessToken } from "./token-service.server";
import { ebayFetch, ebayErrorMessage } from "./draft.server";

interface MinimalSupabase {
  from: (table: string) => any;
}

const NOT_CONFIGURED_MSG =
  "Configure your eBay shipping origin in Settings before publishing.";

export const SHIPPING_ORIGIN_NOT_CONFIGURED = NOT_CONFIGURED_MSG;

function env() {
  return (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
}

export interface ShippingOriginView {
  configured: boolean;
  merchantLocationKey?: string;
  name?: string | null;
  locationTypes?: string[];
  merchantLocationStatus?: string;
  addressLine1?: string | null;
  city?: string | null;
  stateOrProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

const DEFAULT_SHIPPING_ORIGIN: SaveOriginInput = {
  name: "Default Warehouse",
  addressLine1: "711 Shetland Trl",
  city: "Cartersville",
  stateOrProvince: "GA",
  postalCode: "30121-1705",
};

function flatten(key: string, json: any): ShippingOriginView {
  const addr = json?.location?.address ?? json?.address ?? {};
  return {
    configured: true,
    merchantLocationKey: key,
    name: json?.name ?? null,
    locationTypes: json?.locationTypes ?? [],
    merchantLocationStatus: json?.merchantLocationStatus,
    addressLine1: addr.addressLine1 ?? null,
    city: addr.city ?? null,
    stateOrProvince: addr.stateOrProvince ?? null,
    postalCode: addr.postalCode ?? null,
    country: addr.country ?? null,
  };
}

async function loadAccount(supabase: MinimalSupabase) {
  const { data, error } = await supabase
    .from("marketplace_accounts")
    .select("id, merchant_location_key")
    .eq("marketplace", "ebay")
    .eq("environment", env())
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; merchant_location_key: string | null } | null;
}

async function getLocation(token: string, key: string) {
  return ebayFetch(
    env(),
    "GET",
    `/sell/inventory/v1/location/${encodeURIComponent(key)}`,
    token,
  );
}

export async function getShippingOrigin(
  supabase: MinimalSupabase,
): Promise<ShippingOriginView> {
  const account = await loadAccount(supabase);
  if (!account?.merchant_location_key) return { configured: false };
  const token = await getValidEbayAccessToken();
  const res = await getLocation(token, account.merchant_location_key);
  if (!res.ok || !res.json) return { configured: false };
  return flatten(account.merchant_location_key, res.json);
}

export interface SaveOriginInput {
  name: string;
  addressLine1: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
}

async function persistKey(
  supabase: MinimalSupabase,
  accountId: string,
  key: string,
) {
  const { error } = await supabase
    .from("marketplace_accounts")
    .update({ merchant_location_key: key })
    .eq("id", accountId);
  if (error) throw error;
}

async function createWarehouse(
  token: string,
  key: string,
  input: SaveOriginInput,
) {
  const body = {
    location: {
      address: {
        country: "US",
        city: input.city,
        stateOrProvince: input.stateOrProvince,
        postalCode: input.postalCode,
        addressLine1: input.addressLine1,
      },
    },
    name: input.name,
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
  };
  const res = await ebayFetch(
    env(),
    "POST",
    `/sell/inventory/v1/location/${encodeURIComponent(key)}`,
    token,
    body,
  );
  if (!res.ok && res.status !== 409) {
    throw new Error(
      `Create location: ${ebayErrorMessage(res.status, res.json, res.text)}`,
    );
  }
  // Best-effort enable
  await ebayFetch(
    env(),
    "POST",
    `/sell/inventory/v1/location/${encodeURIComponent(key)}/enable`,
    token,
  );
}

async function updateExistingLocationDetails(
  token: string,
  key: string,
  current: any,
  input: SaveOriginInput,
) {
  const currentAddr = current?.location?.address ?? {};
  const body = {
    name: input.name,
    locationInstructions: current?.locationInstructions,
    locationAdditionalInformation: current?.locationAdditionalInformation,
    locationWebUrl: current?.locationWebUrl,
    phone: current?.phone,
    address: {
      ...currentAddr,
      country: "US",
      city: input.city,
      stateOrProvince: input.stateOrProvince,
      postalCode: input.postalCode,
      addressLine1: input.addressLine1,
    },
  };
  const res = await ebayFetch(
    env(),
    "POST",
    `/sell/inventory/v1/location/${encodeURIComponent(key)}/update_location_details`,
    token,
    body,
  );
  if (!res.ok) {
    throw new Error(
      `Update location: ${ebayErrorMessage(res.status, res.json, res.text)}`,
    );
  }
}

function verifyAddress(view: ShippingOriginView) {
  if (
    view.country !== "US" ||
    !view.postalCode ||
    !view.city ||
    !view.stateOrProvince
  ) {
    throw new Error(
      `Location verification failed: missing city/state/zip/country. Got: ${JSON.stringify({
        city: view.city,
        state: view.stateOrProvince,
        postalCode: view.postalCode,
        country: view.country,
      })}`,
    );
  }
}

export async function saveShippingOrigin(
  supabase: MinimalSupabase,
  input: SaveOriginInput,
): Promise<ShippingOriginView> {
  const account = await loadAccount(supabase);
  if (!account) throw new Error("eBay account not connected");
  const token = await getValidEbayAccessToken();

  let keyToUse: string | null = null;

  if (account.merchant_location_key) {
    const cur = await getLocation(token, account.merchant_location_key);
    if (cur.ok && cur.json) {
      const types: string[] = cur.json?.locationTypes ?? [];
      const isWarehouseOrStore =
        types.includes("WAREHOUSE") || types.includes("STORE");
      if (isWarehouseOrStore) {
        await updateExistingLocationDetails(
          token,
          account.merchant_location_key,
          cur.json,
          input,
        );
        keyToUse = account.merchant_location_key;
      }
      // FULFILLMENT_CENTER or anything else → fall through and create new
    }
  }

  if (!keyToUse) {
    const newKey = `loc_${Date.now()}`;
    await createWarehouse(token, newKey, input);
    keyToUse = newKey;
  }

  const verifyRes = await getLocation(token, keyToUse);
  if (!verifyRes.ok || !verifyRes.json) {
    throw new Error(
      `Verify location: ${ebayErrorMessage(verifyRes.status, verifyRes.json, verifyRes.text)}`,
    );
  }
  const view = flatten(keyToUse, verifyRes.json);
  verifyAddress(view);
  await persistKey(supabase, account.id, keyToUse);
  return view;
}

/**
 * Strict validation used by Publish. Throws the user-facing message when no
 * valid shipping origin is configured. Never auto-creates a generic location.
 */
export async function requireConfiguredShippingOrigin(
  supabase: MinimalSupabase,
): Promise<{ merchantLocationKey: string; view: ShippingOriginView }> {
  const account = await loadAccount(supabase);
  if (!account?.merchant_location_key) {
    throw new Error(NOT_CONFIGURED_MSG);
  }
  const token = await getValidEbayAccessToken();
  const res = await getLocation(token, account.merchant_location_key);
  if (!res.ok || !res.json) throw new Error(NOT_CONFIGURED_MSG);
  const view = flatten(account.merchant_location_key, res.json);
  if (
    view.merchantLocationStatus !== "ENABLED" ||
    view.country !== "US" ||
    !view.postalCode ||
    !view.city ||
    !view.stateOrProvince
  ) {
    throw new Error(NOT_CONFIGURED_MSG);
  }
  return { merchantLocationKey: account.merchant_location_key, view };
}
