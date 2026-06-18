import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface EbayAccountInfo {
  connected: boolean;
  environment?: string;
  accountName?: string | null;
  externalAccountId?: string | null;
  connectedAt?: string;
  status?: string;
  scopes?: string[];
  errorMessage?: string | null;
}

export const getEbayAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EbayAccountInfo> => {
    const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
    const { data, error } = await context.supabase
      .from("marketplace_accounts")
      .select(
        "account_name, external_account_id, connected_at, status, scopes, environment, error_message",
      )
      .eq("marketplace", "ebay")
      .eq("environment", env)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { connected: false, environment: env };
    return {
      connected: data.status === "connected",
      environment: data.environment,
      accountName: data.account_name,
      externalAccountId: data.external_account_id,
      connectedAt: data.connected_at,
      status: data.status,
      scopes: data.scopes,
      errorMessage: data.error_message,
    };
  });

export const startEbayOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const { loadEbayConfig, buildAuthorizeUrl } = await import("./oauth.server");
    const cfg = loadEbayConfig();
    const { url } = await buildAuthorizeUrl(cfg, context.userId);
    return { url };
  });

export const disconnectEbay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
    const { error } = await context.supabase
      .from("marketplace_accounts")
      .delete()
      .eq("marketplace", "ebay")
      .eq("environment", env);
    if (error) throw error;
    return { ok: true };
  });
