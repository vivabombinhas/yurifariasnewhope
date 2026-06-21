# Claude Code Handoff — eBay Integration Audit

## Project context

This is an internal inventory + listing tool for a small US resale business. It is not an ecommerce storefront, SaaS, or marketplace. Each product is unique (`qty = 1`). The V1 priority is operational flow: product intake, photos, AI-assisted listing copy, physical location tracking, eBay listing setup, draft creation, and sandbox publish.

Stack:
- TanStack Start / React / Vite.
- Lovable Cloud backend with Postgres, auth, private photo storage.
- App-internal backend calls are TanStack `createServerFn` functions.
- External public endpoints are route handlers under `src/routes/api/public/*`.

## Current eBay flow in the UI

Main product detail route:
- `src/routes/_authenticated/products.$id.tsx`
  - Loads product, photos, listing rows, status history.
  - Renders `MarketplacePublishingPanel` around line 195.

eBay UI stack:
- `src/components/MarketplacePublishingPanel.tsx`
  - Accordion for marketplaces.
  - eBay panels render in this order:
    1. `EbayCategoryPanel`
    2. `EbayConditionPanel`
    3. `EbayAspectsPanel`
    4. `EbayReadinessPanel`
    5. `EbayDraftPanel`
    6. `EbaySellerSetupPanel`
    7. `EbayPublishPreflightPanel`
    8. `EbayPublishAuditPanel`
    9. `EbayPublishPanel`

## Main files and responsibilities

### Account / OAuth

- `src/lib/marketplaces/ebay/account.functions.ts`
  - `getEbayAccount`
  - `startEbayOAuth`
  - `disconnectEbay`
- `src/routes/api/public/ebay/callback.ts`
  - Public OAuth callback from eBay.
  - Verifies signed state, exchanges OAuth code, stores account tokens in `marketplace_accounts`.
- `src/lib/marketplaces/ebay/oauth.server.ts`
  - Loads eBay env/secrets, state signing, token exchange, user fetch.
- `src/lib/marketplaces/ebay/token-service.server.ts`
  - `getValidEbayAccessToken()` reads stored tokens and refreshes if needed.

### Category, condition, aspects

- `src/lib/marketplaces/ebay/taxonomy.functions.ts`
  - `fetchEbayCategorySuggestions`
  - `saveEbayCategory`
  - `fetchEbayConditionPoliciesForCategory`
  - `saveEbayCondition`
  - `fetchEbayAspectsForCategory`
  - `saveEbayAspects`
  - Important: `saveEbayCategory` and `saveEbayCondition` call `markEbayDraftOutdated`, setting `provider_metadata.draftOutdated = true` for existing draft listings.
- `src/lib/marketplaces/ebay/taxonomy.server.ts`
  - eBay Taxonomy API calls for category suggestions and category aspects.
- `src/lib/marketplaces/ebay/condition-policies.server.ts`
  - Fetches eBay Metadata `get_item_condition_policies` for a category.
  - Maps eBay `conditionId` to inventory `conditionEnum`.
  - `assertConditionIdEnumMatch` blocks invalid ID/enum pairs.

### Readiness / preflight / audit

- `src/lib/marketplaces/ebay/readiness.functions.ts`
  - Product-level readiness before draft creation: account, title, description, price, SKU, photos, category, condition, aspects.
- `src/lib/marketplaces/ebay/publish-preflight.functions.ts`
  - Server function wrapper for offer-level preflight.
- `src/lib/marketplaces/ebay/publish-preflight.server.ts`
  - Reads the actual eBay offer and checks fields needed by publish.
- `src/lib/marketplaces/ebay/publish-audit.functions.ts`
  - Read-only diagnostic report for local product, real InventoryItem, real Offer, category condition policies, and comparisons.
- `src/lib/marketplaces/ebay/publish-audit.server.ts`
  - Low-level read-only eBay API calls used by audit and publish validation.

### Draft creation

- `src/components/EbayDraftPanel.tsx`
  - Calls `createEbayDraft`.
  - Invalidates listing/readiness queries after success.
- `src/lib/marketplaces/ebay/draft.functions.ts`
  - `createEbayDraft` server function.
  - Builds a unique eBay inventory SKU: `internalSku-productIdPrefix-attemptPrefix`.
  - Validates product/photos/readiness.
  - Creates a pending publishing job.
  - Calls `createEbayDraftInSandbox`.
  - Upserts `marketplace_listings` with `status = draft`, `offerId`, `sku`, `internalSku`, condition metadata, `draftOutdated: false`, and `draftCreatedAt`.
- `src/lib/marketplaces/ebay/draft.server.ts`
  - Low-level eBay Sell Inventory API flow:
    1. Optional cleanup of stale unpublished offers for the target SKU.
    2. GET existing InventoryItem.
    3. PUT InventoryItem with product data, aspects, images, and selected condition enum.
    4. GET InventoryItem and verify condition persisted.
    5. If condition drift is detected, delete and recreate InventoryItem.
    6. POST unpublished Offer.
  - Important helper: `isNoOffersForSkuResponse` treats eBay `25713` / 404 as “no existing offers”, not a fatal error.

### Seller setup

- `src/components/EbaySellerSetupPanel.tsx`
- `src/lib/marketplaces/ebay/seller-setup.functions.ts`
- `src/lib/marketplaces/ebay/seller-setup.server.ts`
  - Creates/inspects sandbox merchant location and business policies.
  - `ensureValidMerchantLocation` ensures a valid US merchant location.
  - `setOfferMerchantLocation` patches `merchantLocationKey` onto the unpublished Offer.
  - `syncOfferWithSellerSetup` patches location + fulfillment/payment/return policies.

### Publish

- `src/components/EbayPublishPanel.tsx`
  - Calls `publishEbayListing`.
  - Button disabled if no offer, listing active, draft outdated, readiness blocked, or readiness loading.
- `src/lib/marketplaces/ebay/publish.functions.ts`
  - `publishEbayListing` server function.
  - Loads local listing + product.
  - Validates official eBay condition and condition policies.
  - Reads real InventoryItem / Offer / all offers for SKU.
  - Repairs draft by calling `createEbayDraft` if drift exists.
  - Ensures merchant location.
  - Final audit gates publish.
  - Calls `publishOffer`.
  - Updates `marketplace_listings` to `active` on success.
- `src/lib/marketplaces/ebay/publish.server.ts`
  - Low-level POST `/sell/inventory/v1/offer/{offerId}/publish`.

## Public image endpoint

- `src/routes/api/public/ebay/image.$photoId.ts`
  - Public eBay image proxy.
  - Reads private storage using admin access and returns image bytes.
  - Used because direct signed storage URLs are too long and/or protected for eBay.

## Data tables involved

- `products`
  - Internal SKU, title, description, price, internal condition, eBay category/condition/aspects, `updated_at`.
- `product_photos`
  - Private storage paths and ordering.
- `marketplace_accounts`
  - eBay OAuth tokens, environment, account status, merchant location key.
- `marketplace_listings`
  - One eBay row per product.
  - Key fields: `status`, `external_listing_id`, `listing_url`, `provider_metadata`, `error_message`, `last_failed_step`, `last_error`.
- `publishing_jobs`
  - Logs draft creation attempts and outcomes.

## Exact current product/error state from the reported issue

Product:
- `productId`: `a429c639-d40c-4e33-a166-f7c0d6b22346`
- Internal SKU: `SKU-001050`
- eBay inventory SKU: `SKU-001050-a429c639-3533add6`
- Offer ID: `11187556010`
- Category: `95672`
- eBay condition: `2990 / PRE_OWNED_EXCELLENT / Pre-owned - Excellent`
- Product `updated_at`: `2026-06-21T18:04:25.310882+00:00`
- Listing metadata `draftCreatedAt`: `2026-06-21T18:08:55.369Z`
- Listing metadata `draftOutdated`: `false`

Reported publish error:
```json
{
  "code": "EBAY_PUBLISH_FINAL_AUDIT_FAILED",
  "message": "Final audit failed after repair. Publish blocked.",
  "offerCreatedAt": null,
  "finalCheck": {
    "inventorySkuOk": true,
    "offerSkuOk": true,
    "offerCategoryOk": true,
    "inventoryConditionOk": true,
    "conditionAllowedOk": true,
    "offerFresherThanProductOk": false,
    "exactlyOneUnpublishedOk": true,
    "noPublishedListingOk": true
  }
}
```

Server log for the same attempt showed:
```json
{
  "publishAttemptId": "26c8ba6a-3621-49b2-a2d5-2d834bb496f4",
  "offerStale": true,
  "draftOutdated": false,
  "needsRepair": true
}
```

## Root cause of the current failure

The publish final audit had a bad timestamp rule.

In `src/lib/marketplaces/ebay/publish.functions.ts`, the code required:
```ts
offerFresherThanProductOk = finalOfferCreatedAt >= product.updated_at
```

But eBay Sandbox often does **not** return `createdDate` or `createdAt` on `GET /sell/inventory/v1/offer/{offerId}`. That made `offerCreatedAt` null. A local fallback `draftCreatedAt` was added earlier, but the existing stale-offer logic still treated missing or unreliable eBay timestamps as a blocker. This produced a false failure even when every real eBay comparison passed:
- SKU matched.
- Offer category matched.
- Inventory condition matched.
- Condition was allowed by the category.
- Exactly one unpublished offer existed.
- No published listing existed.

The system was blocking publish because of missing Sandbox metadata, not because the draft was actually invalid.

## Fix applied in this turn

File changed:
- `src/lib/marketplaces/ebay/publish.functions.ts`

Change:
- Removed inferred staleness based on missing eBay offer timestamps.
- `offerStale` now follows explicit local state only: `meta.draftOutdated === true`.
- Final audit `offerFresherThanProductOk` now means “local draft is not explicitly outdated”, not “eBay returned a createdDate newer than product.updated_at”.
- Added diagnostic fields to final audit failure output:
  - `effectiveOfferCreatedAt`
  - `draftCreatedAt`

Why this is safer:
- Category and condition changes already mark drafts outdated through `markEbayDraftOutdated` in `taxonomy.functions.ts`.
- Draft recreation sets `draftOutdated: false` and writes a fresh `draftCreatedAt`.
- eBay Sandbox missing `createdDate` should not block publish when all direct comparisons pass.

## Important recent fixes already in the code

1. eBay `25713 "This Offer is not available"`
   - File: `src/lib/marketplaces/ebay/draft.server.ts`
   - Treated as empty offer list for a new SKU.
   - Prevents new draft creation from failing when no prior offer exists.

2. Removed confusing readiness check
   - File: `src/lib/marketplaces/ebay/readiness.functions.ts`
   - The old “InventoryItem condition confirmed by eBay” check was removed from readiness because it can only be verified after draft creation.

3. Draft metadata timestamp
   - File: `src/lib/marketplaces/ebay/draft.functions.ts`
   - Draft creation persists `draftCreatedAt` in `provider_metadata`.

## High-risk areas for Claude Code to inspect

### 1. Too many overlapping diagnostics/gates

There are now several layers:
- Readiness check.
- Draft creation verification.
- Seller setup panel.
- Publish preflight.
- Publish audit panel.
- Final audit inside publish.

This may be over-engineered for V1. Recommend simplifying to one linear workflow:
1. Connect account.
2. Select category.
3. Select official condition.
4. Fill aspects.
5. Create/recreate draft.
6. Ensure seller setup automatically.
7. Publish.

### 2. Auto-saving eBay condition

File: `src/components/EbayConditionPanel.tsx`

There is an auto-fix effect that may save a suggested condition automatically when saved condition is invalid. This can surprise the user. Consider making condition selection strictly explicit.

### 3. Product edit does not mark eBay draft outdated

File: `src/routes/_authenticated/products.$id.tsx`

The generic product edit form updates title/description/price/internal condition/etc. It does not currently call `markEbayDraftOutdated`. Only eBay category/condition save does. If a user changes title/description/price/photos after draft creation, the local draft may be stale but not flagged.

Suggested direction:
- Either mark draft outdated after any publish-relevant product edit/photo edit.
- Or during publish, repair/update the offer/inventory directly before publish.

### 4. Seller setup may be partial

In `publish.functions.ts`, publish currently ensures merchant location, but the preflight/seller setup code also supports fulfillment/payment/return policies. Confirm whether `publish` should always call `syncOfferWithSellerSetup` instead of only `setOfferMerchantLocation`.

### 5. Official condition enum mapping

File: `src/lib/marketplaces/ebay/condition-policies.server.ts`

The mapping includes category-specific IDs like `2990 -> PRE_OWNED_EXCELLENT`. Validate that this matches the eBay Inventory API enum accepted for the selected category. For category `95672`, current reported condition `PRE_OWNED_EXCELLENT` appears to be accepted by eBay and passed the audit.

## Suggested Claude Code action plan

1. Re-run publish for SKU `SKU-001050` after the current timestamp fix.
2. If eBay returns a new publish error, focus on the real eBay `/publish` response in `last_error.lastPublishRaw` or UI raw response.
3. Simplify `publishEbayListing`:
   - Treat direct remote comparisons as authoritative.
   - Do not block on missing eBay timestamps.
   - Use `draftOutdated` for local stale state.
4. Consider replacing the multiple panels with a single eBay workflow component that shows one next action at a time.
5. Add a publish-relevant “draft dirty” mechanism for product title/description/price/photos changes.
6. Keep marketplace architecture modular: no eBay logic in generic product/listing code except through dedicated eBay modules.

## Files Claude should inspect first

1. `src/lib/marketplaces/ebay/publish.functions.ts`
2. `src/lib/marketplaces/ebay/draft.functions.ts`
3. `src/lib/marketplaces/ebay/draft.server.ts`
4. `src/lib/marketplaces/ebay/publish-audit.functions.ts`
5. `src/lib/marketplaces/ebay/publish-audit.server.ts`
6. `src/lib/marketplaces/ebay/seller-setup.server.ts`
7. `src/lib/marketplaces/ebay/taxonomy.functions.ts`
8. `src/components/MarketplacePublishingPanel.tsx`
9. `src/components/EbayDraftPanel.tsx`
10. `src/components/EbayPublishPanel.tsx`
11. `src/routes/_authenticated/products.$id.tsx`

## Current recommendation

Do not add more audit gates until the basic eBay sandbox flow is stable. The immediate blocker was not a real eBay validation failure; it was a local false-negative caused by relying on `createdDate` that Sandbox does not return.