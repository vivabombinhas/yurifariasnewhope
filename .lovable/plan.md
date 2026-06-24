# eBay Shipping Origin

Adds a Settings panel to view/edit the eBay Inventory Location used as shipping origin, removes the silent fallback to a generic California address, and lets the user retro-apply the new origin to active listings created by the system.

## Files

**New**
- `src/lib/marketplaces/ebay/shipping-origin.server.ts` — pure eBay/Supabase logic.
- `src/lib/marketplaces/ebay/shipping-origin.functions.ts` — `createServerFn` wrappers.
- `src/components/EbayShippingOriginPanel.tsx` — UI panel.

**Edited**
- `src/lib/marketplaces/ebay/seller-setup.server.ts` — `ensureValidMerchantLocation`: stop creating a generic CA warehouse. If no valid location is configured, throw `MERCHANT_LOCATION_NOT_CONFIGURED` with the message `Configure your eBay shipping origin in Settings before publishing.`
- `src/lib/marketplaces/ebay/publish.functions.ts` — map that error to a user-facing block (already returns `errorMessage`; just preserve text).
- `src/routes/_authenticated/settings.tsx` — render `EbayShippingOriginPanel` under the eBay section.

## Server functions

In `shipping-origin.functions.ts` (all `requireSupabaseAuth`):

1. `getEbayShippingOrigin` — reads `marketplace_accounts.merchant_location_key`, then `GET /sell/inventory/v1/location/{key}`. Returns `{ ok, merchantLocationKey, name, locationTypes, merchantLocationStatus, addressLine1, city, stateOrProvince, postalCode, country }` or `{ ok:false, configured:false }` when no key.
2. `saveEbayShippingOrigin({ name, addressLine1, city, stateOrProvince, postalCode })` — country fixed `US`.
   - If no key saved → create new `WAREHOUSE` with `merchantLocationKey = loc_<ts>`, enable, GET to verify, persist key.
   - If current is `WAREHOUSE` or `STORE` → GET, merge name + address, `POST /location/{key}/update_location_details`, GET to verify, keep key.
   - If current is `FULFILLMENT_CENTER` → create new `WAREHOUSE` with new key, enable, verify, persist new key. Do not delete the old one.
3. `countActiveSystemEbayListings` — counts `marketplace_listings` where `marketplace='ebay'`, `status='active'`, `external_listing_id` not null.
4. `applyShippingOriginToActiveListings` — for each active listing: fetch the offer, replace only `merchantLocationKey`, PUT full body back (reusing `setOfferMerchantLocation`). Returns per-listing `{ listingId, ok, error? }`.

All use existing `getValidEbayAccessToken` + `ebayFetch`.

## UI

`EbayShippingOriginPanel` (in Settings):
- Header **eBay Shipping origin**.
- Current location block: human-readable `Shipping from: City, State ZIP, United States` + small details (key, name, type, status).
- Form (controlled): Location name, Address, City, State, ZIP, Country (disabled = `US`). Submit = **Save eBay shipping origin** → calls `saveEbayShippingOrigin`, invalidates query, toasts.
- Below: **Apply shipping origin to active eBay listings** button → opens AlertDialog showing count + confirmation; on confirm calls `applyShippingOriginToActiveListings` and renders per-listing results.

## Publish guardrail

`ensureValidMerchantLocation` no longer auto-creates a CA warehouse. If the saved key is missing/invalid and no valid location exists on the account, throw an error whose message is exactly:

`Configure your eBay shipping origin in Settings before publishing.`

`publish.functions.ts` already surfaces this `errorMessage` to the UI.

## Out of scope (explicit)

No changes to fulfillment policy, shipping cost, handling time, return policy, payment policy, or Sales Sync.

```text
Settings → eBay Shipping origin
 ├── Current: Shipping from: Cartersville, Georgia 30121, United States
 ├── [Form: name, address, city, state, ZIP, country=US (disabled)]  [Save]
 └── [Apply shipping origin to active eBay listings] → confirm dialog
```
