import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
