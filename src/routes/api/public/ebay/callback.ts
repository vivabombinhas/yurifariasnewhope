import { createFileRoute } from "@tanstack/react-router";

/**
 * eBay OAuth callback — public route.
 * eBay redirects the user's browser here (Accept URL configured on the RuName).
 * The signed `state` proves which operator initiated the consent flow.
 */
export const Route = createFileRoute("/api/public/ebay/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        console.log("[ebay/callback] hit", request.url);
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const stateToken = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");
        console.log("[ebay/callback] params", {
          hasCode: !!code,
          hasState: !!stateToken,
          errorParam,
          errorDesc,
        });

        const back = (params: Record<string, string>) => {
          const dest = new URL("/settings", url.origin);
          for (const [k, v] of Object.entries(params)) {
            dest.searchParams.set(k, v);
          }
          return new Response(null, {
            status: 302,
            headers: { Location: dest.toString() },
          });
        };

        if (errorParam) {
          console.log("[ebay/callback] error param", errorParam, errorDesc);
          return back({
            ebay: "error",
            message: errorDesc ?? errorParam,
          });
        }
        if (!code || !stateToken) {
          return back({ ebay: "error", message: "Missing code or state" });
        }

        try {
          const {
            loadEbayConfig,
            verifyState,
            exchangeCodeForTokens,
            fetchEbayUser,
          } = await import("@/lib/marketplaces/ebay/oauth.server");

          const cfg = loadEbayConfig();
          console.log("[ebay/callback] cfg env", cfg.env, "ruName", cfg.ruName);
          const state = await verifyState(stateToken, cfg.stateSecret);
          console.log("[ebay/callback] state verified for uid", state.uid);

          console.log("[ebay/callback] token exchange start");
          const tokens = await exchangeCodeForTokens(cfg, code);
          console.log("[ebay/callback] token exchange ok, expires_in", tokens.expires_in);
          const identity = await fetchEbayUser(cfg, tokens.access_token);
          console.log("[ebay/callback] identity", identity);


          const accessExpiresAt = new Date(
            Date.now() + tokens.expires_in * 1000,
          ).toISOString();

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          // Upsert the single row for (marketplace, environment)
          const { data: existing } = await supabaseAdmin
            .from("marketplace_accounts")
            .select("id")
            .eq("marketplace", "ebay")
            .eq("environment", cfg.env)
            .maybeSingle();

          const row = {
            marketplace: "ebay" as const,
            environment: cfg.env,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token ?? "",
            token_expires_at: accessExpiresAt,
            connected_at: new Date().toISOString(),
            last_refresh_at: new Date().toISOString(),
            status: "connected",
            error_message: null,
            account_name: identity.username ?? null,
            external_account_id: identity.userId ?? null,
            scopes: tokens.access_token
              ? (await import("@/lib/marketplaces/ebay/oauth.server")).EBAY_SCOPES
              : [],
            metadata: {
              connected_by_user_id: state.uid,
              refresh_token_expires_in:
                tokens.refresh_token_expires_in ?? null,
            },
          };

          if (existing) {
            console.log("[ebay/callback] updating existing row", existing.id);
            const { error } = await supabaseAdmin
              .from("marketplace_accounts")
              .update(row)
              .eq("id", existing.id);
            if (error) throw error;
          } else {
            console.log("[ebay/callback] inserting new row");
            const { error } = await supabaseAdmin
              .from("marketplace_accounts")
              .insert(row);
            if (error) throw error;
          }
          console.log("[ebay/callback] saved successfully");

          return back({ ebay: "connected" });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error("[ebay/callback] FAILED", message, e);
          return back({ ebay: "error", message });
        }
      },

    },
  },
});
