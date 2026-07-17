# eBay Best Offer Support

Add "Allow offers" / Minimum offer / Auto accept automation to every eBay listing the system creates, so these fields never need to be filled manually on eBay.

Confirmed against the eBay Inventory API: `Offer.listingPolicies.bestOfferTerms` with fields `bestOfferEnabled` (boolean), `autoAcceptPrice` (Amount) and `autoDeclinePrice` (Amount). "Minimum offer" from the UI = `autoDeclinePrice` (offers below this are auto-declined).

## 1. Data model

New table `ebay_offer_settings` (one row per user, global defaults):

```
user_id (pk)  allow_offers boolean
minimum_mode  'off' | 'percentage' | 'fixed'
minimum_percentage numeric(5,2)    -- 0.01..99.99
minimum_amount_cents integer
auto_accept_mode 'off' | 'percentage' | 'fixed'
auto_accept_percentage numeric(5,2)
auto_accept_amount_cents integer
updated_at
```

RLS: user owns own row. GRANT to authenticated + service_role.

Per-product override columns on `products`:
- `ebay_offer_override` boolean default false
- `ebay_offer_allow` boolean null
- `ebay_offer_minimum_mode`, `ebay_offer_minimum_percentage`, `ebay_offer_minimum_amount_cents`
- `ebay_offer_auto_accept_mode`, `ebay_offer_auto_accept_percentage`, `ebay_offer_auto_accept_amount_cents`

Defaults on new install: allow=ON, minimum=percentage 70, auto_accept=off.

## 2. Resolution + validation helper

`src/lib/marketplaces/ebay/best-offer.ts` (pure, no I/O):
- `resolveBestOfferForProduct(globalSettings, productOverride, priceCents)` → `{ enabled, autoAcceptCents?, autoDeclineCents? }` or `{ enabled:false }`.
- Percentage → `round(priceCents * pct / 100)`, 2-decimal (cent) precision.
- `validateSettings(settings, referencePriceCents?)` returns Zod-style errors for:
  - min/auto-accept > 0
  - max 2 decimals (cents integer already enforces this)
  - if reference price given: minimum < price, auto_accept ≤ price
  - if both active: auto_accept > minimum

Used by both the Settings form and per-product override editor.

## 3. Server functions

`src/lib/marketplaces/ebay/best-offer.functions.ts`:
- `getEbayOfferSettings` — read global row (create default lazily).
- `updateEbayOfferSettings` — validate + upsert.
- `updateProductOfferOverride({ productId, override, ... })` — validate against product's price.
- `applyOfferSettingsToActiveListings` — enumerate active `marketplace_listings` for eBay, GET each offer, merge Best Offer fields into `listingPolicies.bestOfferTerms`, PUT full offer back, record per-listing result. Preserves every other field. Never publishes / withdraws.
- `countActiveEbayListings` — for confirmation dialog.

## 4. Publish integration

In `src/lib/marketplaces/ebay/publish.functions.ts` (and initial offer body in `draft.server.ts` if we want it set on creation):
- After resolving policies, resolve Best Offer via `resolveBestOfferForProduct` using the product's price.
- Merge into `offerBody.listingPolicies.bestOfferTerms`:
  ```
  { bestOfferEnabled: true,
    autoAcceptPrice: { value, currency },   // when set
    autoDeclinePrice: { value, currency } } // when set (= "minimum offer")
  ```
- When disabled, set `{ bestOfferEnabled: false }` and omit prices.
- Same code path used by "Apply offer settings to active listings", so publish and bulk-apply are consistent.

Do not touch shipping origin, sales sync, photos, or fulfillment policies.

## 5. UI

**Settings → `EbayOfferSettingsPanel.tsx`** (new, added to `settings.tsx` right below shipping origin):
- Toggle Allow offers by default.
- Minimum offer: mode select (Off / % / $) + numeric input.
- Auto accept: mode select + numeric input, with warning banner "Auto accept can sell items automatically at or above this amount." shown whenever mode ≠ off before Save.
- Inline validation errors from the shared helper.
- "Apply offer settings to active eBay listings" button → confirmation dialog showing active-listing count, then runs bulk apply and shows per-listing success/error list.

**Product page** — extend `EbayPublishPanel` (or a small new `EbayOfferPanel` subcomponent):
- Advanced disclosure "Override offer settings" (checkbox).
- When on: same three controls as global, validated against product price.
- When off: show read-only summary derived from resolved settings:
  - `Offers: On / Minimum: 70% / $14.00 / Auto accept: Off` (or `Offers: Off`).

## 6. Safety & edge cases

- Bulk apply requires explicit confirmation and shows count first.
- Ignore listings where eBay returns "Best Offer not supported for this category" — log warning per listing, keep going, surface count in result.
- All monetary inputs stored as integer cents; percentages as numeric(5,2). Never negative, never zero, never > price.
- Never modify a listing not created by the system (filtered via `marketplace_listings.marketplace_account_id` for the current user + `source = 'system'` equivalent already used elsewhere).

## 7. Tests / manual checks

Run through the scenarios listed in the request against sandbox+production:
new product offers-only, minimum 70%, auto-accept 90%, cheap-item rounding, per-product override, bulk update of one active listing, invalid inputs blocked, category-that-rejects-BestOffer handled gracefully.

## Files

New:
- `supabase` migration: `ebay_offer_settings` table + product override columns + grants + RLS.
- `src/lib/marketplaces/ebay/best-offer.ts`
- `src/lib/marketplaces/ebay/best-offer.functions.ts`
- `src/components/EbayOfferSettingsPanel.tsx`
- `src/components/EbayOfferOverridePanel.tsx` (used inside product page)

Edited:
- `src/lib/marketplaces/ebay/publish.functions.ts` — inject Best Offer terms.
- `src/routes/_authenticated/settings.tsx` — mount new panel.
- `src/routes/_authenticated/products.$id.tsx` (or existing `EbayPublishPanel.tsx`) — mount override panel + summary.
- `src/integrations/supabase/types.ts` — regenerated after migration.

Nothing else in shipping/sales/photos/policies changes.
