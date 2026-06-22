import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Manual "Sync now" trigger from Settings → eBay. Reuses the exact same
 * helper as the cron — per-account DB lock + 60s manual cooldown protect
 * against concurrent clicks across serverless instances.
 */
export const syncEbayOrdersNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ dryRun: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { runEbaySyncOrders } = await import("./sync-orders.server");
    return runEbaySyncOrders({
      dryRun: !!data.dryRun,
      source: "manual",
      enforceManualCooldown: true,
    });
  });

/**
 * Read-only status for the "Sync now" panel: recent sales counts and last
 * error info, without ever exposing the marketplace_sales table directly.
 */
export const getEbayOrdersSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const env = String(process.env.EBAY_ENV ?? "sandbox").toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: account } = await supabaseAdmin
      .from("marketplace_accounts")
      .select(
        "id, status, last_orders_sync_at, last_orders_sync_attempt_at, last_orders_sync_status, last_orders_sync_error, orders_sync_lock_at",
      )
      .eq("marketplace", "ebay")
      .eq("environment", env)
      .maybeSingle();

    if (!account) {
      return {
        connected: false as const,
      };
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: salesCount } = await supabaseAdmin
      .from("marketplace_sales")
      .select("id", { count: "exact", head: true })
      .eq("marketplace_account_id", account.id)
      .eq("processing_status", "matched")
      .gte("processed_at", since);

    const { count: unmatchedCount } = await supabaseAdmin
      .from("marketplace_sales")
      .select("id", { count: "exact", head: true })
      .eq("marketplace_account_id", account.id)
      .eq("processing_status", "unmatched")
      .gte("processed_at", since);

    return {
      connected: true as const,
      accountStatus: account.status,
      lastSuccessAt: account.last_orders_sync_at,
      lastAttemptAt: account.last_orders_sync_attempt_at,
      lastStatus: account.last_orders_sync_status,
      lastError: account.last_orders_sync_error,
      lockHeld: !!account.orders_sync_lock_at,
      lockHeldAt: account.orders_sync_lock_at,
      salesLast24h: salesCount ?? 0,
      unmatchedLast24h: unmatchedCount ?? 0,
    };
  });
