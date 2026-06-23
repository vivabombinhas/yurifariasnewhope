import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

/**
 * One-shot bootstrap: copies EBAY_ORDER_SYNC_SECRET (env) into the Vault.
 * Authorized with the same EBAY_ORDER_SYNC_SECRET via Authorization: Bearer.
 * Idempotent — safe to call multiple times.
 */
export const Route = createFileRoute("/api/public/admin/bootstrap-vault")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.EBAY_ORDER_SYNC_SECRET ?? "";
        if (!expected || expected.length < 32) {
          return new Response("Server misconfigured", { status: 500 });
        }
        const auth = request.headers.get("authorization") ?? "";
        const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        let ok = false;
        try {
          const a = Buffer.from(provided);
          const b = Buffer.from(expected);
          ok = a.length === b.length && timingSafeEqual(a, b);
        } catch {
          ok = false;
        }
        if (!ok) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { error: e1 } = await supabaseAdmin.rpc("set_vault_secret", {
          _name: "EBAY_ORDER_SYNC_SECRET",
          _value: expected,
          _description: "eBay order sync shared secret (cron auth)",
        });
        if (e1) {
          return new Response(JSON.stringify({ error: e1.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { error: e2 } = await supabaseAdmin.rpc("set_vault_secret", {
          _name: "EBAY_ORDER_SYNC_URL",
          _value:
            "https://yurifariasnewhope.lovable.app/api/public/ebay/sync-orders",
          _description: "eBay order sync production endpoint URL",
        });
        if (e2) {
          return new Response(JSON.stringify({ error: e2.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
