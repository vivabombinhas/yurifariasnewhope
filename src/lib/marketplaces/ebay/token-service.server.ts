/**
 * eBay token service — SERVER ONLY.
 * Returns a valid access_token, refreshing transparently when expired.
 */
import { loadEbayConfig, refreshAccessToken } from "./oauth.server";

const SKEW_SECONDS = 60;

export async function getValidEbayAccessToken(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cfg = loadEbayConfig();

  const { data: row, error } = await supabaseAdmin
    .from("marketplace_accounts")
    .select("*")
    .eq("marketplace", "ebay")
    .eq("environment", cfg.env)
    .maybeSingle();

  if (error) throw error;
  if (!row) throw new Error("eBay account not connected");

  const expiresAt = new Date(row.token_expires_at).getTime();
  if (expiresAt > Date.now() + SKEW_SECONDS * 1000) {
    return row.access_token;
  }

  // Refresh
  try {
    const t = await refreshAccessToken(cfg, row.refresh_token);
    const newExpiry = new Date(Date.now() + t.expires_in * 1000).toISOString();
    await supabaseAdmin
      .from("marketplace_accounts")
      .update({
        access_token: t.access_token,
        token_expires_at: newExpiry,
        last_refresh_at: new Date().toISOString(),
        status: "connected",
        error_message: null,
      })
      .eq("id", row.id);
    return t.access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("marketplace_accounts")
      .update({ status: "error", error_message: msg })
      .eq("id", row.id);
    throw e;
  }
}
