import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface CreateDraftDTO {
  ok: boolean;
  offerId?: string;
  sku?: string;
  errorMessage?: string;
}

const PHOTO_SIGNED_URL_TTL = 60 * 60; // 1h

export const createEbayDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CreateDraftDTO> => {
    console.log("[createEbayDraft] started", { productId: data.productId });
    const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
    if (env !== "sandbox") {
      console.warn("[createEbayDraft] aborted: non-sandbox env", { env });
      return { ok: false, errorMessage: "Draft creation is restricted to sandbox environment." };
    }

    // Run readiness check first
    const { checkEbayReadiness } = await import("./readiness.functions");
    const readiness = await checkEbayReadiness({ data: { productId: data.productId } });
    if (!readiness.ready) {
      const missing = readiness.checks
        .filter((c) => c.status !== "ok")
        .map((c) => c.label)
        .join(", ");
      return { ok: false, errorMessage: `Product not ready: ${missing}` };
    }

    // Load product + photos
    const { data: product, error: pErr } = await context.supabase
      .from("products")
      .select(
        "id, sku, title, description, price_cents, condition, ebay_category_id, ebay_aspects",
      )
      .eq("id", data.productId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!product) return { ok: false, errorMessage: "Product not found" };

    const { data: photos, error: phErr } = await context.supabase
      .from("product_photos")
      .select("storage_path, position, is_cover")
      .eq("product_id", data.productId)
      .order("is_cover", { ascending: false })
      .order("position", { ascending: true });
    if (phErr) throw phErr;

    // Generate signed URLs for photos (private bucket)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const imageUrls: string[] = [];
    for (const ph of photos ?? []) {
      const { data: signed, error: sErr } = await supabaseAdmin.storage
        .from("product-photos")
        .createSignedUrl(ph.storage_path, PHOTO_SIGNED_URL_TTL);
      if (sErr) continue;
      if (signed?.signedUrl) imageUrls.push(signed.signedUrl);
    }
    if (!imageUrls.length) {
      return { ok: false, errorMessage: "No accessible photos for this product" };
    }

    // Create publishing job (pending)
    const { data: job, error: jErr } = await context.supabase
      .from("publishing_jobs")
      .insert({
        product_id: data.productId,
        marketplace: "ebay",
        action: "create_draft",
        status: "pending",
        payload: { env, sku: product.sku, categoryId: product.ebay_category_id },
      })
      .select("id")
      .single();
    if (jErr) throw jErr;

    try {
      const { createEbayDraftInSandbox } = await import("./draft.server");
      const result = await createEbayDraftInSandbox({
        sku: product.sku,
        title: product.title,
        description: product.description,
        priceCents: product.price_cents ?? 0,
        condition: product.condition ?? "",
        categoryId: product.ebay_category_id!,
        aspects: product.ebay_aspects,
        imageUrls,
      });
      console.log("[createEbayDraft] offer created", { offerId: result.offerId, sku: result.sku });

      // Upsert marketplace_listings (ebay, status=draft)
      const { data: existing } = await context.supabase
        .from("marketplace_listings")
        .select("id")
        .eq("product_id", data.productId)
        .eq("marketplace", "ebay")
        .maybeSingle();

      const listingPatch = {
        status: "draft" as const,
        external_listing_id: null,
        error_message: null,
        provider_metadata: { offerId: result.offerId, sku: result.sku, env },
      };

      if (existing) {
        await context.supabase
          .from("marketplace_listings")
          .update(listingPatch)
          .eq("id", existing.id);
      } else {
        await context.supabase.from("marketplace_listings").insert({
          product_id: data.productId,
          marketplace: "ebay",
          ...listingPatch,
        });
      }

      await context.supabase
        .from("publishing_jobs")
        .update({
          status: "success",
          processed_at: new Date().toISOString(),
          result: { offerId: result.offerId, sku: result.sku },
          last_error: null,
        })
        .eq("id", job.id);

      console.log("[eBay draft]", {
        product_id: data.productId,
        sku: result.sku,
        offerId: result.offerId,
      });
      return { ok: true, offerId: result.offerId, sku: result.sku };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[createEbayDraft] failed", { productId: data.productId, error: msg });
      await context.supabase
        .from("publishing_jobs")
        .update({
          status: "error",
          processed_at: new Date().toISOString(),
          last_error: msg,
        })
        .eq("id", job.id);

      // Also surface error on listing row if exists
      await context.supabase
        .from("marketplace_listings")
        .update({ error_message: msg })
        .eq("product_id", data.productId)
        .eq("marketplace", "ebay");

      console.error("[eBay draft] failed", { product_id: data.productId, msg });
      return { ok: false, errorMessage: msg };
    }
  });
