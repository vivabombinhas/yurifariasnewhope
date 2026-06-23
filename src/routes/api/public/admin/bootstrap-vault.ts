import { createFileRoute } from "@tanstack/react-router";

/**
 * One-shot bootstrap: copies EBAY_ORDER_SYNC_SECRET (env) and the production
 * sync URL into the Vault. Idempotent. No auth — endpoint only reads server
 * env (already trusted) and writes into vault.secrets via a SECURITY DEFINER
 * RPC; it never returns secret values.
 */
export const Route = createFileRoute("/api/public/admin/bootstrap-vault")({
  server: {
    handlers: {
      POST: async () => {
        const secret = process.env.EBAY_ORDER_SYNC_SECRET ?? "";
        if (!secret || secret.length < 32) {
          return new Response(
            JSON.stringify({ error: "EBAY_ORDER_SYNC_SECRET missing or too short" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { error: e1 } = await supabaseAdmin.rpc("set_vault_secret", {
          _name: "EBAY_ORDER_SYNC_SECRET",
          _value: secret,
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

        return new Response(
          JSON.stringify({
            ok: true,
            wrote: ["EBAY_ORDER_SYNC_SECRET", "EBAY_ORDER_SYNC_URL"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
