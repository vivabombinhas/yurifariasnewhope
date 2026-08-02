import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MarketplaceId } from "@/lib/marketplaces";
import { renderListing, type ItemSpecific } from "@/lib/marketplaces/render";
import { normalizeListingUrl } from "@/lib/marketplaces/listing-url";
import { closeOtherActiveListings } from "@/lib/marketplaces/close-product-listings.server";

/**
 * Assisted publishing for Poshmark and Depop.
 *
 * No external API calls. We prepare a per-marketplace payload, let the user
 * copy fields and open the marketplace site, then record the URL/status.
 *
 * Uses existing marketplace_listings columns only:
 *   status ∈ {draft, active, sold, ended, removed}
 *     draft  = prepared / ready to post
 *     active = manually marked published (URL captured)
 *     sold   = manually marked sold
 *   listing_url, published_at, sold_at, provider_metadata (jsonb)
 */

const ASSISTED: ReadonlySet<MarketplaceId> = new Set(["poshmark", "depop"]);

const Marketplace = z.enum(["poshmark", "depop"]) as unknown as z.ZodType<MarketplaceId>;

function pickSpec(specs: ItemSpecific[], names: string[]): string | null {
  for (const s of specs) {
    if (!s?.name || !s?.value) continue;
    const n = s.name.trim().toLowerCase();
    if (names.some((x) => x.toLowerCase() === n)) return s.value.trim();
  }
  return null;
}

type Field = { key: string; label: string; value: string | null; required: boolean };

function buildFields(marketplace: MarketplaceId, p: any): Field[] {
  const specs: ItemSpecific[] = Array.isArray(p.item_specifics) ? p.item_specifics : [];
  const brand = p.brand?.name ?? pickSpec(specs, ["Brand"]) ?? null;
  const category = p.category?.name ?? null;
  const condition =
    p.condition_grade || (p.condition ? String(p.condition).replace(/_/g, " ") : null);
  const size = pickSpec(specs, ["Size", "US Size", "Shoe Size"]);
  const color = pickSpec(specs, ["Color", "Colour", "Primary Color"]);
  const material = pickSpec(specs, ["Material", "Fabric"]);
  const style = pickSpec(specs, ["Style", "Type"]);
  const categoryNeedsSize =
    /\b(clothing|apparel|shoes?|footwear|dress|shirt|pants|jeans|shorts|skirt|jacket|coat|sweater|hoodie|swimwear|lingerie)\b/i.test(
      category ?? "",
    );

  const base: Field[] = [
    { key: "title", label: "Title", value: p.title || null, required: true },
    {
      key: "price",
      label: "Price",
      value:
        p.price_cents != null
          ? new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: p.currency || "USD",
            }).format(p.price_cents / 100)
          : null,
      required: true,
    },
    { key: "condition", label: "Condition", value: condition, required: true },
    { key: "category", label: "Category", value: category, required: true },
    { key: "brand", label: "Brand", value: brand, required: false },
  ];

  base.push(
    { key: "size", label: "Size", value: size, required: categoryNeedsSize },
    { key: "color", label: "Color", value: color, required: false },
    { key: "material", label: "Material", value: material, required: false },
  );
  if (marketplace === "depop") {
    base.push({ key: "style", label: "Style / Tags", value: style, required: false });
  }
  return base;
}

const GetInput = z.object({
  productId: z.string().uuid(),
  marketplace: Marketplace,
});

export const getAssistedListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GetInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!ASSISTED.has(data.marketplace)) {
      throw new Error(`Marketplace ${data.marketplace} is not assisted.`);
    }
    const { supabase } = context;

    const { data: product, error: pErr } = await supabase
      .from("products")
      .select(
        "id, sku, title, description, price_cents, currency, condition, condition_grade, condition_notes, shipping_notes, item_specifics, brand:brands(name), category:categories(name)",
      )
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

    const rendered = renderListing(data.marketplace, product as any);
    const fields = buildFields(data.marketplace, product);
    const missing = fields.filter((f) => f.required && !f.value).map((f) => f.label);

    const { data: photos } = await supabase
      .from("product_photos")
      .select("id, storage_path, position, is_cover")
      .eq("product_id", data.productId)
      .order("position", { ascending: true });

    const paths = (photos ?? []).map((p) => p.storage_path);
    let urls: Record<string, string | null> = {};
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from("product-photos")
        .createSignedUrls(paths, 3600);
      (signed ?? []).forEach((s, i) => {
        urls[(photos ?? [])[i].id] = s.signedUrl ?? null;
      });
    }
    const photoList = (photos ?? []).map((ph) => ({
      id: ph.id,
      position: ph.position,
      is_cover: ph.is_cover,
      url: urls[ph.id] ?? null,
    }));

    const { data: listing } = await supabase
      .from("marketplace_listings")
      .select("id, status, listing_url, published_at, sold_at, provider_metadata, updated_at")
      .eq("product_id", data.productId)
      .eq("marketplace", data.marketplace)
      .maybeSingle();

    return {
      marketplace: data.marketplace,
      payload: {
        title: rendered.title,
        description: rendered.description,
        priceCents: product.price_cents,
        currency: product.currency,
        fields,
      },
      missingFields: missing,
      photos: photoList,
      listing,
    };
  });

const PrepareInput = z.object({
  productId: z.string().uuid(),
  marketplace: Marketplace,
});

/** Upsert a `draft` row so the product shows as "Ready to post". */
export const prepareAssistedListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PrepareInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!ASSISTED.has(data.marketplace)) throw new Error("Not an assisted marketplace.");
    const { supabase } = context;
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, status")
      .eq("product_id", data.productId)
      .eq("marketplace", data.marketplace)
      .maybeSingle();

    if (existing) {
      // Don't overwrite active/sold rows.
      if (existing.status === "draft") {
        await supabase
          .from("marketplace_listings")
          .update({
            provider_metadata: { assisted: true, prepared_at: new Date().toISOString() },
          })
          .eq("id", existing.id);
      }
      return { ok: true, id: existing.id };
    }

    const { data: row, error } = await supabase
      .from("marketplace_listings")
      .insert({
        product_id: data.productId,
        marketplace: data.marketplace,
        status: "draft",
        provider_metadata: { assisted: true, prepared_at: new Date().toISOString() },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

const PublishInput = z.object({
  productId: z.string().uuid(),
  marketplace: Marketplace,
  listingUrl: z.string().trim().url("Listing URL must be a valid URL."),
});

export const markAssistedPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PublishInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!ASSISTED.has(data.marketplace)) throw new Error("Not an assisted marketplace.");
    const { supabase } = context;
    const now = new Date().toISOString();
    const normalized = normalizeListingUrl(data.marketplace, data.listingUrl);

    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, provider_metadata")
      .eq("product_id", data.productId)
      .eq("marketplace", data.marketplace)
      .maybeSingle();

    const meta = {
      ...((existing?.provider_metadata as any) ?? {}),
      assisted: true,
      marked_published_at: now,
    };

    if (existing) {
      const { error } = await supabase
        .from("marketplace_listings")
        .update({
          status: "active",
          listing_url: normalized.url,
          external_listing_id: normalized.externalListingId,
          published_at: now,
          listed_at: now,
          provider_metadata: meta,
          error_message: null,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: existing.id };
    }

    const { data: row, error } = await supabase
      .from("marketplace_listings")
      .insert({
        product_id: data.productId,
        marketplace: data.marketplace,
        status: "active",
        listing_url: normalized.url,
        external_listing_id: normalized.externalListingId,
        published_at: now,
        listed_at: now,
        provider_metadata: meta,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

const CloseInput = z.object({
  productId: z.string().uuid(),
  marketplace: Marketplace,
});

export const markAssistedClosed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CloseInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: listing, error } = await context.supabase
      .from("marketplace_listings")
      .select("id, provider_metadata")
      .eq("product_id", data.productId)
      .eq("marketplace", data.marketplace)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!listing) throw new Error("No active listing found.");

    const metadata = (listing.provider_metadata as Record<string, unknown>) ?? {};
    const { error: updateError } = await context.supabase
      .from("marketplace_listings")
      .update({
        status: "ended",
        error_message: null,
        last_failed_step: null,
        provider_metadata: {
          ...metadata,
          closurePending: false,
          manuallyClosedAt: new Date().toISOString(),
        },
      })
      .eq("id", listing.id);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  });

const SoldInput = z.object({
  productId: z.string().uuid(),
  marketplace: Marketplace,
});

const ProgressInput = z.object({
  productId: z.string().uuid(),
  marketplace: Marketplace,
  progress: z.record(z.string(), z.any()),
  reset: z.boolean().optional(),
});

/**
 * Merge a partial mobilePostingProgress object into provider_metadata.
 * Never touches listing_url, published_at, status, or other provider_metadata keys.
 * When `reset: true`, clears only the mobilePostingProgress key.
 */
export const saveMobileProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProgressInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!ASSISTED.has(data.marketplace)) throw new Error("Not an assisted marketplace.");
    const { supabase } = context;

    // RLS check: the read enforces the user can access this product's listing scope.
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("id")
      .eq("id", data.productId)
      .maybeSingle();
    if (prodErr) throw new Error(prodErr.message);
    if (!product) throw new Error("Product not found");

    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, provider_metadata")
      .eq("product_id", data.productId)
      .eq("marketplace", data.marketplace)
      .maybeSingle();

    const now = new Date().toISOString();
    const currentMeta = (existing?.provider_metadata as Record<string, any>) ?? {};
    const currentProgress = (currentMeta.mobilePostingProgress as Record<string, any>) ?? {};

    const nextProgress = data.reset
      ? null
      : { ...currentProgress, ...data.progress, updatedAt: now };

    const nextMeta: Record<string, any> = { ...currentMeta };
    if (nextProgress === null) delete nextMeta.mobilePostingProgress;
    else nextMeta.mobilePostingProgress = nextProgress;

    if (existing) {
      const { error } = await supabase
        .from("marketplace_listings")
        .update({ provider_metadata: nextMeta })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { ok: true, progress: nextProgress };
    }

    // No row yet — create a draft only if we have progress to save.
    if (nextProgress === null) return { ok: true, progress: null };
    const { error } = await supabase.from("marketplace_listings").insert({
      product_id: data.productId,
      marketplace: data.marketplace,
      status: "draft",
      provider_metadata: {
        assisted: true,
        prepared_at: now,
        mobilePostingProgress: nextProgress,
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true, progress: nextProgress };
  });

export const markAssistedSold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SoldInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!ASSISTED.has(data.marketplace)) throw new Error("Not an assisted marketplace.");
    const { supabase } = context;
    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, provider_metadata")
      .eq("product_id", data.productId)
      .eq("marketplace", data.marketplace)
      .maybeSingle();

    const meta = {
      ...((existing?.provider_metadata as any) ?? {}),
      assisted: true,
      marked_sold_at: now,
    };

    if (existing) {
      const { error } = await supabase
        .from("marketplace_listings")
        .update({
          status: "sold",
          sold_at: now,
          provider_metadata: meta,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("marketplace_listings").insert({
        product_id: data.productId,
        marketplace: data.marketplace,
        status: "sold",
        sold_at: now,
        provider_metadata: meta,
      });
      if (error) throw new Error(error.message);
    }

    // Reflect on product. Don't touch other marketplaces; surface them in UI.
    await supabase
      .from("products")
      .update({ status: "sold" })
      .eq("id", data.productId)
      .neq("status", "sold");

    const closureResults = await closeOtherActiveListings(
      supabase,
      data.productId,
      data.marketplace,
    );

    return { ok: true, closureResults };
  });
