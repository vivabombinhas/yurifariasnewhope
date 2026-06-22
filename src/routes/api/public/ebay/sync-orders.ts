import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

/**
 * Public endpoint invoked by pg_cron every 10 minutes.
 * Authentication: `Authorization: Bearer <EBAY_ORDER_SYNC_SECRET>` (timing-safe).
 * Returns aggregated counts only — no buyer PII, no tokens.
 */
export const Route = createFileRoute("/api/public/ebay/sync-orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.EBAY_ORDER_SYNC_SECRET ?? "";
        if (!expected) {
          return new Response("Server misconfigured", { status: 500 });
        }
        const auth = request.headers.get("authorization") ?? "";
        const prefix = "Bearer ";
        const provided = auth.startsWith(prefix) ? auth.slice(prefix.length) : "";

        // Same-length check BEFORE timingSafeEqual; always return same response.
        let ok = false;
        try {
          const a = Buffer.from(provided);
          const b = Buffer.from(expected);
          ok = a.length === b.length && timingSafeEqual(a, b);
        } catch {
          ok = false;
        }
        if (!ok) {
          return new Response("Unauthorized", { status: 401 });
        }

        let dryRun = false;
        try {
          const body = await request.json().catch(() => ({}));
          dryRun = !!body?.dryRun;
        } catch {
          /* ignore */
        }

        const { runEbaySyncOrders } = await import(
          "@/lib/marketplaces/ebay/sync-orders.server"
        );
        const result = await runEbaySyncOrders({ dryRun, source: "cron" });

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
