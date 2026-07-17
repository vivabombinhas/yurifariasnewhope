/**
 * Pure helpers for eBay Best Offer settings.
 * No I/O — safe to import from client and server.
 */
import { z } from "zod";

export type OfferMode = "off" | "percentage" | "fixed";

export interface OfferSettingsCore {
  allow_offers: boolean;
  minimum_mode: OfferMode;
  minimum_percentage: number | null;
  minimum_amount_cents: number | null;
  auto_accept_mode: OfferMode;
  auto_accept_percentage: number | null;
  auto_accept_amount_cents: number | null;
}

export interface ProductOfferOverride {
  ebay_offer_override: boolean;
  ebay_offer_allow: boolean | null;
  ebay_offer_minimum_mode: OfferMode | null;
  ebay_offer_minimum_percentage: number | null;
  ebay_offer_minimum_amount_cents: number | null;
  ebay_offer_auto_accept_mode: OfferMode | null;
  ebay_offer_auto_accept_percentage: number | null;
  ebay_offer_auto_accept_amount_cents: number | null;
}

export interface ResolvedBestOffer {
  enabled: boolean;
  autoAcceptCents: number | null;
  autoDeclineCents: number | null; // "minimum offer"
}

/** Zod schema for saving global settings (and reusable for override). */
export const offerSettingsSchema = z
  .object({
    allow_offers: z.boolean(),
    minimum_mode: z.enum(["off", "percentage", "fixed"]),
    minimum_percentage: z.number().gt(0).lt(100).nullable(),
    minimum_amount_cents: z.number().int().gt(0).nullable(),
    auto_accept_mode: z.enum(["off", "percentage", "fixed"]),
    auto_accept_percentage: z.number().gt(0).lte(100).nullable(),
    auto_accept_amount_cents: z.number().int().gt(0).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.minimum_mode === "percentage" && v.minimum_percentage == null) {
      ctx.addIssue({ code: "custom", path: ["minimum_percentage"], message: "Required" });
    }
    if (v.minimum_mode === "fixed" && v.minimum_amount_cents == null) {
      ctx.addIssue({ code: "custom", path: ["minimum_amount_cents"], message: "Required" });
    }
    if (v.auto_accept_mode === "percentage" && v.auto_accept_percentage == null) {
      ctx.addIssue({ code: "custom", path: ["auto_accept_percentage"], message: "Required" });
    }
    if (v.auto_accept_mode === "fixed" && v.auto_accept_amount_cents == null) {
      ctx.addIssue({ code: "custom", path: ["auto_accept_amount_cents"], message: "Required" });
    }
  });

function computeAmountCents(
  mode: OfferMode,
  pct: number | null,
  amt: number | null,
  priceCents: number,
): number | null {
  if (mode === "off") return null;
  if (mode === "percentage") {
    if (pct == null) return null;
    return Math.round((priceCents * pct) / 100);
  }
  if (mode === "fixed") return amt ?? null;
  return null;
}

/**
 * Combine global + optional per-product override, then compute the resolved
 * Best Offer values in cents for a given price.
 */
export function resolveBestOfferForProduct(
  globalSettings: OfferSettingsCore | null,
  productOverride: ProductOfferOverride | null,
  priceCents: number | null,
): ResolvedBestOffer {
  if (priceCents == null || priceCents <= 0 || !globalSettings) {
    return { enabled: false, autoAcceptCents: null, autoDeclineCents: null };
  }

  const useOverride = productOverride?.ebay_offer_override === true;
  const src: OfferSettingsCore = useOverride
    ? {
        allow_offers: productOverride!.ebay_offer_allow ?? globalSettings.allow_offers,
        minimum_mode:
          (productOverride!.ebay_offer_minimum_mode as OfferMode | null) ??
          globalSettings.minimum_mode,
        minimum_percentage:
          productOverride!.ebay_offer_minimum_percentage ??
          globalSettings.minimum_percentage,
        minimum_amount_cents:
          productOverride!.ebay_offer_minimum_amount_cents ??
          globalSettings.minimum_amount_cents,
        auto_accept_mode:
          (productOverride!.ebay_offer_auto_accept_mode as OfferMode | null) ??
          globalSettings.auto_accept_mode,
        auto_accept_percentage:
          productOverride!.ebay_offer_auto_accept_percentage ??
          globalSettings.auto_accept_percentage,
        auto_accept_amount_cents:
          productOverride!.ebay_offer_auto_accept_amount_cents ??
          globalSettings.auto_accept_amount_cents,
      }
    : globalSettings;

  if (!src.allow_offers) {
    return { enabled: false, autoAcceptCents: null, autoDeclineCents: null };
  }

  const autoDeclineCents = computeAmountCents(
    src.minimum_mode,
    src.minimum_percentage,
    src.minimum_amount_cents,
    priceCents,
  );
  const autoAcceptCents = computeAmountCents(
    src.auto_accept_mode,
    src.auto_accept_percentage,
    src.auto_accept_amount_cents,
    priceCents,
  );

  return {
    enabled: true,
    autoAcceptCents:
      autoAcceptCents != null && autoAcceptCents > 0 && autoAcceptCents <= priceCents
        ? autoAcceptCents
        : null,
    autoDeclineCents:
      autoDeclineCents != null && autoDeclineCents > 0 && autoDeclineCents < priceCents
        ? autoDeclineCents
        : null,
  };
}

/**
 * Validate consistency against a reference price. Returns null if OK, error
 * message otherwise. Used both for global save and product override save.
 */
export function validateAgainstPrice(
  s: OfferSettingsCore,
  referencePriceCents: number | null,
): string | null {
  if (!s.allow_offers) return null;
  if (referencePriceCents == null || referencePriceCents <= 0) return null;

  const minCents = computeAmountCents(
    s.minimum_mode,
    s.minimum_percentage,
    s.minimum_amount_cents,
    referencePriceCents,
  );
  const accCents = computeAmountCents(
    s.auto_accept_mode,
    s.auto_accept_percentage,
    s.auto_accept_amount_cents,
    referencePriceCents,
  );

  if (minCents != null && minCents >= referencePriceCents) {
    return "Minimum offer must be less than the listing price.";
  }
  if (accCents != null && accCents > referencePriceCents) {
    return "Auto accept must be less than or equal to the listing price.";
  }
  if (minCents != null && accCents != null && accCents <= minCents) {
    return "Auto accept must be greater than the minimum offer.";
  }
  return null;
}

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** Short human summary for a product card. */
export function summarizeResolved(
  resolved: ResolvedBestOffer,
  priceCents: number | null,
  src: OfferSettingsCore,
): string {
  if (!resolved.enabled) return "Offers: Off";
  const parts = ["Offers: On"];
  if (resolved.autoDeclineCents != null) {
    const pct =
      src.minimum_mode === "percentage" && src.minimum_percentage != null
        ? ` (${src.minimum_percentage}%)`
        : "";
    parts.push(`Minimum: ${formatCents(resolved.autoDeclineCents)}${pct}`);
  } else {
    parts.push("Minimum: —");
  }
  if (resolved.autoAcceptCents != null) {
    const pct =
      src.auto_accept_mode === "percentage" && src.auto_accept_percentage != null
        ? ` (${src.auto_accept_percentage}%)`
        : "";
    parts.push(`Auto accept: ${formatCents(resolved.autoAcceptCents)}${pct}`);
  } else {
    parts.push("Auto accept: Off");
  }
  void priceCents;
  return parts.join(" · ");
}
