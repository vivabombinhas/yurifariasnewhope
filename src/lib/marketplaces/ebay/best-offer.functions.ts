import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  offerSettingsSchema,
  resolveBestOfferForProduct,
  validateAgainstPrice,
  type OfferSettingsCore,
  type ProductOfferOverride,
  type ResolvedBestOffer,
} from "./best-offer";

const SETTINGS_ID = "global";

async function loadGlobalSettings(supabase: any): Promise<OfferSettingsCore> {
  const { data, error } = await supabase
    .from("ebay_offer_settings")
    .select("*")
    .eq("id", SETTINGS_ID)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as OfferSettingsCore;
  // Lazy-create defaults if the singleton row is missing.
  const defaults: OfferSettingsCore & { id: string } = {
    id: SETTINGS_ID,
    allow_offers: true,
    minimum_mode: "percentage",
    minimum_percentage: 70,
    minimum_amount_cents: null,
    auto_accept_mode: "off",
    auto_accept_percentage: null,
    auto_accept_amount_cents: null,
  };
  const { data: inserted, error: insErr } = await supabase
    .from("ebay_offer_settings")
    .insert(defaults)
    .select("*")
    .single();
  if (insErr) throw insErr;
  return inserted as OfferSettingsCore;
}

export const getEbayOfferSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true; settings: OfferSettingsCore } | { ok: false; errorMessage: string }> => {
    try {
      const settings = await loadGlobalSettings(context.supabase);
      return { ok: true, settings };
    } catch (e: any) {
      return { ok: false, errorMessage: e?.message ?? String(e) };
    }
  });

export const updateEbayOfferSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => offerSettingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const err = validateAgainstPrice(data as OfferSettingsCore, null);
    if (err) return { ok: false as const, errorMessage: err };
    const { data: row, error } = await context.supabase
      .from("ebay_offer_settings")
      .upsert({ id: SETTINGS_ID, ...data })
      .select("*")
      .single();
    if (error) return { ok: false as const, errorMessage: error.message };
    return { ok: true as const, settings: row as OfferSettingsCore };
  });

const OverrideSchema = z.object({
  productId: z.string().uuid(),
  override: z.boolean(),
  allow_offers: z.boolean().nullable(),
  minimum_mode: z.enum(["off", "percentage", "fixed"]).nullable(),
  minimum_percentage: z.number().gt(0).lt(100).nullable(),
  minimum_amount_cents: z.number().int().gt(0).nullable(),
  auto_accept_mode: z.enum(["off", "percentage", "fixed"]).nullable(),
  auto_accept_percentage: z.number().gt(0).lte(100).nullable(),
  auto_accept_amount_cents: z.number().int().gt(0).nullable(),
});

export const updateProductOfferOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OverrideSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: product, error: pErr } = await context.supabase
      .from("products")
      .select("id, price_cents")
      .eq("id", data.productId)
      .maybeSingle();
    if (pErr) return { ok: false as const, errorMessage: pErr.message };
    if (!product) return { ok: false as const, errorMessage: "Product not found" };

    if (data.override) {
      const global = await loadGlobalSettings(context.supabase);
      const merged: OfferSettingsCore = {
        allow_offers: data.allow_offers ?? global.allow_offers,
        minimum_mode: data.minimum_mode ?? global.minimum_mode,
        minimum_percentage: data.minimum_percentage ?? global.minimum_percentage,
        minimum_amount_cents: data.minimum_amount_cents ?? global.minimum_amount_cents,
        auto_accept_mode: data.auto_accept_mode ?? global.auto_accept_mode,
        auto_accept_percentage: data.auto_accept_percentage ?? global.auto_accept_percentage,
        auto_accept_amount_cents: data.auto_accept_amount_cents ?? global.auto_accept_amount_cents,
      };
      const err = validateAgainstPrice(merged, product.price_cents);
      if (err) return { ok: false as const, errorMessage: err };
    }

    const { error } = await context.supabase
      .from("products")
      .update({
        ebay_offer_override: data.override,
        ebay_offer_allow: data.allow_offers,
        ebay_offer_minimum_mode: data.minimum_mode,
        ebay_offer_minimum_percentage: data.minimum_percentage,
        ebay_offer_minimum_amount_cents: data.minimum_amount_cents,
        ebay_offer_auto_accept_mode: data.auto_accept_mode,
        ebay_offer_auto_accept_percentage: data.auto_accept_percentage,
        ebay_offer_auto_accept_amount_cents: data.auto_accept_amount_cents,
      })
      .eq("id", data.productId);
    if (error) return { ok: false as const, errorMessage: error.message };
    return { ok: true as const };
  });

/** Resolve final Best Offer for a specific product (used in UI summary). */
export const resolveProductOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: product, error: pErr }, global] = await Promise.all([
      context.supabase
        .from("products")
        .select(
          "id, price_cents, ebay_offer_override, ebay_offer_allow, ebay_offer_minimum_mode, ebay_offer_minimum_percentage, ebay_offer_minimum_amount_cents, ebay_offer_auto_accept_mode, ebay_offer_auto_accept_percentage, ebay_offer_auto_accept_amount_cents",
        )
        .eq("id", data.productId)
        .maybeSingle(),
      loadGlobalSettings(context.supabase),
    ]);
    if (pErr) return { ok: false as const, errorMessage: pErr.message };
    if (!product) return { ok: false as const, errorMessage: "Product not found" };
    const override = product as unknown as ProductOfferOverride;
    const resolved = resolveBestOfferForProduct(global, override, product.price_cents ?? null);
    return {
      ok: true as const,
      global,
      product: override,
      price_cents: product.price_cents ?? null,
      resolved,
    };
  });

export interface ApplyOfferResult {
  listingId: string;
  productId: string;
  externalListingId: string | null;
  offerId: string | null;
  ok: boolean;
  error?: string;
  category?: string;
  resolved?: ResolvedBestOffer;
}

export const applyOfferSettingsToActiveListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true; results: ApplyOfferResult[] } | { ok: false; errorMessage: string }> => {
    try {
      const global = await loadGlobalSettings(context.supabase);
      const { data: rows, error } = await context.supabase
        .from("marketplace_listings")
        .select(
          "id, product_id, external_listing_id, provider_metadata, products!inner(id, price_cents, ebay_offer_override, ebay_offer_allow, ebay_offer_minimum_mode, ebay_offer_minimum_percentage, ebay_offer_minimum_amount_cents, ebay_offer_auto_accept_mode, ebay_offer_auto_accept_percentage, ebay_offer_auto_accept_amount_cents)",
        )
        .eq("marketplace", "ebay")
        .eq("status", "active")
        .not("external_listing_id", "is", null);
      if (error) throw error;

      const { applyBestOfferToOffer } = await import("./best-offer.server");
      const results: ApplyOfferResult[] = [];
      for (const row of (rows ?? []) as any[]) {
        const offerId: string | null = (row.provider_metadata ?? {}).offerId ?? null;
        const product = row.products;
        const override = product as ProductOfferOverride;
        const resolved = resolveBestOfferForProduct(global, override, product?.price_cents ?? null);
        const r: ApplyOfferResult = {
          listingId: row.id,
          productId: row.product_id,
          externalListingId: row.external_listing_id,
          offerId,
          ok: false,
          resolved,
        };
        if (!offerId) {
          r.error = "Missing offerId in provider_metadata";
          results.push(r);
          continue;
        }
        const res = await applyBestOfferToOffer(offerId, resolved);
        if (res.ok) {
          r.ok = true;
        } else {
          r.error = res.error;
          r.category = res.category;
        }
        results.push(r);
      }
      return { ok: true, results };
    } catch (e: any) {
      return { ok: false, errorMessage: e?.message ?? String(e) };
    }
  });
