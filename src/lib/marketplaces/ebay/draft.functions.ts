import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface CreateDraftDTO {
  ok: boolean;
  offerId?: string;
  sku?: string;
  categoryId?: string;
  ebayConditionId?: number;
  ebayConditionName?: string;
  ebayConditionEnum?: string;
  errorMessage?: string;
}

const EBAY_MAX_PHOTOS = 12;
const EBAY_MAX_URL_LEN = 500;
const EBAY_MAX_TOTAL_LEN = 3975;

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
        "id, sku, title, description, price_cents, condition, ebay_category_id, ebay_condition_id, ebay_condition_enum, ebay_condition_name, ebay_aspects",
      )
      .eq("id", data.productId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!product) return { ok: false, errorMessage: "Product not found" };

    const { data: currentListing, error: listingErr } = await context.supabase
      .from("marketplace_listings")
      .select("id, status, external_listing_id, provider_metadata")
      .eq("product_id", data.productId)
      .eq("marketplace", "ebay")
      .maybeSingle();
    if (listingErr) throw listingErr;
    if (currentListing?.status === "active") {
      return {
        ok: false,
        errorMessage:
          "This eBay listing is already published. Create a separate fresh draft only after explicitly ending or confirming the active listing workflow.",
      };
    }

    const { data: photos, error: phErr } = await context.supabase
      .from("product_photos")
      .select("id, storage_path, position, is_cover")
      .eq("product_id", data.productId)
      .order("is_cover", { ascending: false })
      .order("position", { ascending: true });
    if (phErr) throw phErr;

    // Build short, public, stable proxy URLs (eBay limits: ≤500 chars per URL,
    // ≤3975 total, ≤12 photos). Use PUBLIC_APP_ORIGIN — the request host
    // (id-preview--*.lovable.app) is auth-gated and redirects to an auth bridge,
    // so eBay cannot fetch images from it.
    const publicOrigin = (process.env.PUBLIC_APP_ORIGIN ?? "").replace(/\/+$/, "");
    if (!publicOrigin) {
      return {
        ok: false,
        errorMessage:
          "PUBLIC_APP_ORIGIN is not configured. Set it to a stable public origin such as https://project--<project-id>-dev.lovable.app (preview) or https://project--<project-id>.lovable.app (published) so eBay can fetch product images.",
      };
    }
    if (!/^https:\/\//i.test(publicOrigin)) {
      return { ok: false, errorMessage: `PUBLIC_APP_ORIGIN must start with https:// (got ${publicOrigin})` };
    }

    const candidateUrls: string[] = [];
    let totalLen = 0;
    for (const ph of (photos ?? []).slice(0, EBAY_MAX_PHOTOS)) {
      const u = `${publicOrigin}/api/public/ebay/image/${ph.id}`;
      if (u.length > EBAY_MAX_URL_LEN) continue;
      if (totalLen + u.length > EBAY_MAX_TOTAL_LEN) break;
      candidateUrls.push(u);
      totalLen += u.length;
    }
    if (!candidateUrls.length) {
      return { ok: false, errorMessage: "No accessible photos for this product" };
    }

    // Validate each URL is publicly reachable as an image (no auth redirect).
    const imageUrls: string[] = [];
    const rejected: { url: string; reason: string }[] = [];
    for (const u of candidateUrls) {
      try {
        let resp = await fetch(u, { method: "GET", redirect: "manual" });
        // Allow one image→image redirect chain, but reject auth-bridge redirects.
        if (resp.status >= 300 && resp.status < 400) {
          const loc = resp.headers.get("location") ?? "";
          if (/auth-bridge|\/auth\b|login/i.test(loc)) {
            rejected.push({ url: u, reason: `redirects to auth (${loc.slice(0, 120)})` });
            continue;
          }
          resp = await fetch(u, { method: "GET", redirect: "follow" });
        }
        if (resp.status !== 200) {
          rejected.push({ url: u, reason: `HTTP ${resp.status}` });
          continue;
        }
        const ct = (resp.headers.get("content-type") ?? "").toLowerCase();
        if (!ct.startsWith("image/")) {
          rejected.push({ url: u, reason: `content-type ${ct || "unknown"}` });
          continue;
        }
        imageUrls.push(u);
      } catch (e: any) {
        rejected.push({ url: u, reason: `fetch error: ${e?.message ?? e}` });
      }
    }
    if (!imageUrls.length) {
      return {
        ok: false,
        errorMessage:
          `No image URLs passed validation against PUBLIC_APP_ORIGIN=${publicOrigin}. ` +
          rejected.map((r) => `${r.url} → ${r.reason}`).join(" | "),
      };
    }
    if (rejected.length) {
      console.warn("[createEbayDraft] some image URLs rejected", rejected);
    }

    // Create publishing job (pending)
    const { data: job, error: jErr } = await context.supabase
      .from("publishing_jobs")
      .insert({
        product_id: data.productId,
        marketplace: "ebay",
        action: "create_draft",
        status: "pending",
        payload: {
          env,
          sku: product.sku,
          categoryId: product.ebay_category_id,
          ebayConditionId: product.ebay_condition_id,
          ebayConditionEnum: product.ebay_condition_enum,
        },
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
        internalCondition: product.condition ?? null,
        ebayConditionId: product.ebay_condition_id!,
        ebayConditionEnum: product.ebay_condition_enum!,
        ebayConditionName: product.ebay_condition_name!,
        categoryId: product.ebay_category_id!,
        aspects: product.ebay_aspects,
        imageUrls,
      });
      console.log("[createEbayDraft] offer created", {
        offerId: result.offerId,
        sku: result.sku,
        categoryId: product.ebay_category_id,
        ebayConditionId: product.ebay_condition_id,
        ebayConditionName: product.ebay_condition_name,
        ebayConditionEnum: product.ebay_condition_enum,
      });

      // Upsert marketplace_listings (ebay, status=draft)
      const existing = currentListing ? { id: currentListing.id } : null;

      const listingPatch = {
        status: "draft" as const,
        external_listing_id: null,
        error_message: null,
        provider_metadata: {
          offerId: result.offerId,
          sku: result.sku,
          env,
          categoryId: product.ebay_category_id,
          ebayConditionId: product.ebay_condition_id,
          ebayConditionName: product.ebay_condition_name,
          ebayConditionEnum: product.ebay_condition_enum,
          draftOutdated: false,
        },
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
          result: {
            offerId: result.offerId,
            sku: result.sku,
            categoryId: product.ebay_category_id,
            ebayConditionId: product.ebay_condition_id,
            ebayConditionEnum: product.ebay_condition_enum,
          },
          last_error: null,
        })
        .eq("id", job.id);

      console.log("[eBay draft]", {
        product_id: data.productId,
        sku: result.sku,
        offerId: result.offerId,
      });
      return {
        ok: true,
        offerId: result.offerId,
        sku: result.sku,
        categoryId: product.ebay_category_id ?? undefined,
        ebayConditionId: product.ebay_condition_id ?? undefined,
        ebayConditionName: product.ebay_condition_name ?? undefined,
        ebayConditionEnum: product.ebay_condition_enum ?? undefined,
      };
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
