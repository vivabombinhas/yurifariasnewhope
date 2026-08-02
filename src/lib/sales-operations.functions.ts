import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { closeOtherActiveListings } from "@/lib/marketplaces/close-product-listings.server";

export const listSalesOperations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    const [{ data: pending, error: pendingError }, { data: sales, error: salesError }] =
      await Promise.all([
        supabase
          .from("marketplace_listings")
          .select(
            "id, product_id, marketplace, listing_url, updated_at, provider_metadata, product:products(title, sku)",
          )
          .eq("status", "active")
          .eq("last_failed_step", "manual_close_required")
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("marketplace_sales")
          .select(
            "id, marketplace, external_order_id, processing_status, processed_at, order_created_at, sku, product_id, product:products(title, sku)",
          )
          .order("processed_at", { ascending: false })
          .limit(50),
      ]);

    if (pendingError) throw new Error(pendingError.message);
    if (salesError) throw new Error(salesError.message);
    return { pendingClosures: pending ?? [], recentSales: sales ?? [] };
  });

export const searchSellableProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ search: z.string().trim().max(100).default("") }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("products")
      .select("id, sku, title, status")
      .neq("status", "sold")
      .order("updated_at", { ascending: false })
      .limit(20);
    if (data.search) {
      const safe = data.search.replace(/[%_,()]/g, " ").trim();
      if (safe) query = query.or(`sku.ilike.%${safe}%,title.ilike.%${safe}%`);
    }
    const { data: products, error } = await query;
    if (error) throw new Error(error.message);
    return products ?? [];
  });

const ManualSaleInput = z.object({
  productId: z.string().uuid(),
  soldOn: z.enum(["ebay", "poshmark", "depop", "local"]),
});

export const registerManualSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ManualSaleInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const now = new Date().toISOString();

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, status")
      .eq("id", data.productId)
      .single();
    if (productError || !product) throw new Error(productError?.message ?? "Product not found.");
    if (product.status === "sold") throw new Error("This product is already marked as sold.");

    if (data.soldOn !== "local") {
      const { data: listing } = await supabase
        .from("marketplace_listings")
        .select("id, provider_metadata")
        .eq("product_id", data.productId)
        .eq("marketplace", data.soldOn)
        .maybeSingle();
      if (listing) {
        const metadata = (listing.provider_metadata as Record<string, unknown>) ?? {};
        const { error } = await supabase
          .from("marketplace_listings")
          .update({
            status: "sold",
            sold_at: now,
            error_message: null,
            last_failed_step: null,
            provider_metadata: { ...metadata, manuallyMarkedSoldAt: now },
          })
          .eq("id", listing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("marketplace_listings").insert({
          product_id: data.productId,
          marketplace: data.soldOn,
          status: "sold",
          sold_at: now,
          provider_metadata: { manuallyMarkedSoldAt: now },
        });
        if (error) throw new Error(error.message);
      }
    }

    const { error: updateError } = await supabase
      .from("products")
      .update({ status: "sold" })
      .eq("id", data.productId);
    if (updateError) throw new Error(updateError.message);

    const closureResults = await closeOtherActiveListings(
      supabase,
      data.productId,
      data.soldOn === "local" ? undefined : data.soldOn,
    );
    return { ok: true, closureResults };
  });
