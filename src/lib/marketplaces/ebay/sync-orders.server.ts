/**
 * eBay Sales Sync — SERVER ONLY.
 *
 * Polls the Fulfillment API for PAID orders and records each line item in
 * `marketplace_sales`. Matched line items also mark the corresponding product
 * + listing as sold via the SECURITY DEFINER RPC `record_marketplace_sale`.
 *
 * The same helper is invoked by:
 *   - the pg_cron-driven public endpoint (/api/public/ebay/sync-orders), and
 *   - the authenticated "Sync now" server function.
 *
 * Account-level lock (DB-backed, TTL 10 min) guarantees no concurrent runs
 * per account, whether triggered by cron or the manual button.
 *
 * NOTE: Never log access tokens, buyer name/email/phone/address, payment
 * data, or the Authorization header.
 */
import { loadEbayConfig, refreshAccessToken } from "./oauth.server";

const FULFILLMENT_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly";
const PAGE_LIMIT = 200;
const MAX_PAGES = 25; // safety cap (200 * 25 = 5000 orders / run)
const MANUAL_COOLDOWN_SECONDS = 60;
const FIRST_RUN_MAX_DAYS = 90;
const FIRST_RUN_FALLBACK_DAYS = 30;
const OVERLAP_MINUTES = 15;

function apiHost(env: string) {
  return env === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface SyncOrdersAccountResult {
  accountId: string;
  marketplace: "ebay";
  environment: string;
  status: "success" | "skipped_locked" | "needs_reconnect" | "error";
  ordersFetched: number;
  lineItemsProcessed: number;
  salesRecorded: number;
  alreadyProcessed: number;
  unmatchedItems: number;
  errors: Array<{ stage: string; message: string }>;
  dryRun: boolean;
  windowStart?: string;
  windowEnd?: string;
}

export interface SyncOrdersResult {
  status: "success" | "partial" | "error";
  startedAt: string;
  finishedAt: string;
  accountsProcessed: number;
  ordersFetched: number;
  lineItemsProcessed: number;
  salesRecorded: number;
  alreadyProcessed: number;
  unmatchedItems: number;
  errors: Array<{ accountId?: string; stage: string; message: string }>;
  dryRun: boolean;
  accounts: SyncOrdersAccountResult[];
}

export interface RunEbaySyncOptions {
  dryRun?: boolean;
  source?: "cron" | "manual";
  /** When 'manual', enforce per-account 60s cooldown using last_orders_sync_attempt_at. */
  enforceManualCooldown?: boolean;
}

/* -------------------------------------------------------------------------- */
/* PII redaction                                                              */
/* -------------------------------------------------------------------------- */

function redactLineItem(li: any) {
  return {
    lineItemId: li?.lineItemId,
    sku: li?.sku,
    legacyItemId: li?.legacyItemId,
    quantity: li?.quantity,
    lineItemFulfillmentStatus: li?.lineItemFulfillmentStatus,
  };
}

function redactOrder(order: any) {
  return {
    orderId: order?.orderId,
    legacyOrderId: order?.legacyOrderId,
    creationDate: order?.creationDate,
    lastModifiedDate: order?.lastModifiedDate,
    orderPaymentStatus: order?.orderPaymentStatus,
    orderFulfillmentStatus: order?.orderFulfillmentStatus,
    sellerId: order?.sellerId,
    salesRecordReference: order?.salesRecordReference,
    lineItems: Array.isArray(order?.lineItems)
      ? order.lineItems.map(redactLineItem)
      : [],
    // explicitly omitted: buyer, fulfillmentStartInstructions, pricingSummary
    // (totals/amounts), payments, fulfillmentHrefs, etc.
  };
}

/* -------------------------------------------------------------------------- */
/* HTTP with retry/backoff                                                    */
/* -------------------------------------------------------------------------- */

async function ebayGetWithRetry(
  url: string,
  token: string,
): Promise<{ ok: boolean; status: number; json: any | null; text: string }> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Language": "en-US",
          "Accept-Language": "en-US",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* ignore */
      }
      if (res.ok) return { ok: true, status: res.status, json, text };
      // retry on 429/5xx
      if (res.status === 429 || res.status >= 500) {
        lastErr = { status: res.status, json, text };
        await sleep(1000 * Math.pow(3, attempt));
        continue;
      }
      return { ok: false, status: res.status, json, text };
    } catch (e: any) {
      lastErr = { status: 0, text: String(e?.message ?? e), json: null };
      await sleep(1000 * Math.pow(3, attempt));
    }
  }
  return {
    ok: false,
    status: lastErr?.status ?? 0,
    text: lastErr?.text ?? "Network error",
    json: lastErr?.json ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Token refresh + scope check                                                */
/* -------------------------------------------------------------------------- */

async function ensureAccessTokenForFulfillment(
  supabaseAdmin: any,
  account: any,
): Promise<
  | { ok: true; token: string }
  | { ok: false; reason: "needs_reconnect" | "error"; message: string }
> {
  const cfg = loadEbayConfig();
  const scopes: string[] = Array.isArray(account.scopes) ? account.scopes : [];
  if (!scopes.includes(FULFILLMENT_SCOPE)) {
    await supabaseAdmin
      .from("marketplace_accounts")
      .update({
        status: "needs_reconnect",
        last_orders_sync_status: "needs_reconnect",
        last_orders_sync_error: {
          reason: "missing_scope",
          missing: FULFILLMENT_SCOPE,
        },
      })
      .eq("id", account.id);
    return {
      ok: false,
      reason: "needs_reconnect",
      message: `Missing OAuth scope: ${FULFILLMENT_SCOPE}. Please reconnect eBay.`,
    };
  }

  const skewMs = 60 * 1000;
  const expiresAt = new Date(account.token_expires_at).getTime();
  if (expiresAt > Date.now() + skewMs) {
    return { ok: true, token: account.access_token };
  }
  try {
    const t = await refreshAccessToken(cfg, account.refresh_token);
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
      .eq("id", account.id);
    return { ok: true, token: t.access_token };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const needsReconnect =
      /invalid_grant|invalid_scope|unauthorized_client|expired/i.test(msg);
    await supabaseAdmin
      .from("marketplace_accounts")
      .update({
        status: needsReconnect ? "needs_reconnect" : "error",
        last_orders_sync_status: needsReconnect ? "needs_reconnect" : "error",
        last_orders_sync_error: { reason: "token_refresh_failed", message: msg },
      })
      .eq("id", account.id);
    return {
      ok: false,
      reason: needsReconnect ? "needs_reconnect" : "error",
      message: msg,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Window computation                                                         */
/* -------------------------------------------------------------------------- */

async function computeWindowStart(
  supabaseAdmin: any,
  account: any,
  endOfWindow: Date,
): Promise<Date> {
  if (account.last_orders_sync_at) {
    const last = new Date(account.last_orders_sync_at).getTime();
    return new Date(last - OVERLAP_MINUTES * 60 * 1000);
  }
  // First run: oldest of (first listing date, 90d cap), fallback 30d
  const { data: firstListing } = await supabaseAdmin
    .from("marketplace_listings")
    .select("published_at, listed_at, created_at")
    .eq("marketplace", "ebay")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const ninetyDaysAgo = new Date(
    endOfWindow.getTime() - FIRST_RUN_MAX_DAYS * 86400 * 1000,
  );
  const fallback = new Date(
    endOfWindow.getTime() - FIRST_RUN_FALLBACK_DAYS * 86400 * 1000,
  );

  if (firstListing) {
    const candidate =
      firstListing.published_at ??
      firstListing.listed_at ??
      firstListing.created_at;
    if (candidate) {
      const c = new Date(candidate);
      return c < ninetyDaysAgo ? ninetyDaysAgo : c;
    }
  }
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Main entry                                                                 */
/* -------------------------------------------------------------------------- */

export async function runEbaySyncOrders(
  opts: RunEbaySyncOptions = {},
): Promise<SyncOrdersResult> {
  const startedAt = new Date().toISOString();
  const dryRun = !!opts.dryRun;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const env = String(process.env.EBAY_ENV ?? "sandbox").toLowerCase();
  const { data: accounts, error } = await supabaseAdmin
    .from("marketplace_accounts")
    .select("*")
    .eq("marketplace", "ebay")
    .eq("environment", env);

  if (error) {
    return {
      status: "error",
      startedAt,
      finishedAt: new Date().toISOString(),
      accountsProcessed: 0,
      ordersFetched: 0,
      lineItemsProcessed: 0,
      salesRecorded: 0,
      alreadyProcessed: 0,
      unmatchedItems: 0,
      errors: [{ stage: "load_accounts", message: error.message }],
      dryRun,
      accounts: [],
    };
  }

  const results: SyncOrdersAccountResult[] = [];
  for (const account of accounts ?? []) {
    if (opts.enforceManualCooldown && account.last_orders_sync_attempt_at) {
      const ageSec =
        (Date.now() - new Date(account.last_orders_sync_attempt_at).getTime()) /
        1000;
      if (ageSec < MANUAL_COOLDOWN_SECONDS) {
        results.push({
          accountId: account.id,
          marketplace: "ebay",
          environment: account.environment,
          status: "error",
          ordersFetched: 0,
          lineItemsProcessed: 0,
          salesRecorded: 0,
          alreadyProcessed: 0,
          unmatchedItems: 0,
          errors: [
            {
              stage: "cooldown",
              message: `Manual sync cooldown: try again in ${Math.ceil(
                MANUAL_COOLDOWN_SECONDS - ageSec,
              )}s`,
            },
          ],
          dryRun,
        });
        continue;
      }
    }
    const r = await syncOrdersForAccount(supabaseAdmin, account, dryRun);
    results.push(r);
  }

  const agg = results.reduce(
    (a, r) => ({
      ordersFetched: a.ordersFetched + r.ordersFetched,
      lineItemsProcessed: a.lineItemsProcessed + r.lineItemsProcessed,
      salesRecorded: a.salesRecorded + r.salesRecorded,
      alreadyProcessed: a.alreadyProcessed + r.alreadyProcessed,
      unmatchedItems: a.unmatchedItems + r.unmatchedItems,
    }),
    {
      ordersFetched: 0,
      lineItemsProcessed: 0,
      salesRecorded: 0,
      alreadyProcessed: 0,
      unmatchedItems: 0,
    },
  );
  const errors = results.flatMap((r) =>
    r.errors.map((e) => ({ accountId: r.accountId, ...e })),
  );
  const anyError = results.some(
    (r) => r.status === "error" || r.status === "needs_reconnect",
  );
  const allSkipped = results.length > 0 && results.every((r) => r.status === "skipped_locked");
  const status: SyncOrdersResult["status"] = anyError
    ? results.some((r) => r.status === "success")
      ? "partial"
      : "error"
    : allSkipped
      ? "partial"
      : "success";

  return {
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    accountsProcessed: results.length,
    ...agg,
    errors,
    dryRun,
    accounts: results,
  };
}

/* -------------------------------------------------------------------------- */
/* Per-account sync                                                           */
/* -------------------------------------------------------------------------- */

async function syncOrdersForAccount(
  supabaseAdmin: any,
  account: any,
  dryRun: boolean,
): Promise<SyncOrdersAccountResult> {
  const result: SyncOrdersAccountResult = {
    accountId: account.id,
    marketplace: "ebay",
    environment: account.environment,
    status: "success",
    ordersFetched: 0,
    lineItemsProcessed: 0,
    salesRecorded: 0,
    alreadyProcessed: 0,
    unmatchedItems: 0,
    errors: [],
    dryRun,
  };

  // 1. Lock
  const { data: lockOk } = await supabaseAdmin.rpc(
    "try_acquire_orders_sync_lock",
    { _account_id: account.id, _ttl_seconds: 600 },
  );
  if (!lockOk) {
    result.status = "skipped_locked";
    result.errors.push({
      stage: "lock",
      message: "Another sync is already running for this account",
    });
    return result;
  }

  try {
    // 2. Record attempt (don't expose tokens)
    await supabaseAdmin
      .from("marketplace_accounts")
      .update({ last_orders_sync_attempt_at: new Date().toISOString() })
      .eq("id", account.id);

    // 3. Token + scope
    const tokenRes = await ensureAccessTokenForFulfillment(
      supabaseAdmin,
      account,
    );
    if (!tokenRes.ok) {
      result.status =
        tokenRes.reason === "needs_reconnect" ? "needs_reconnect" : "error";
      result.errors.push({ stage: "auth", message: tokenRes.message });
      return result;
    }
    const token = tokenRes.token;

    // 4. Window
    const endOfWindow = new Date();
    const windowStart = await computeWindowStart(
      supabaseAdmin,
      account,
      endOfWindow,
    );
    result.windowStart = windowStart.toISOString();
    result.windowEnd = endOfWindow.toISOString();

    // 5. Page through Fulfillment API
    const host = apiHost(account.environment);
    const filter = `lastmodifieddate:[${windowStart.toISOString()}..${endOfWindow.toISOString()}]`;
    let offset = 0;
    let hadFetchError = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${host}/sell/fulfillment/v1/order?filter=${encodeURIComponent(
        filter,
      )}&limit=${PAGE_LIMIT}&offset=${offset}`;
      const res = await ebayGetWithRetry(url, token);
      if (!res.ok) {
        hadFetchError = true;
        const errMsg = res.json?.errors?.[0]?.message ?? res.text?.slice(0, 500) ?? "Unknown";
        result.errors.push({
          stage: `fetch_orders_page_${page}`,
          message: `HTTP ${res.status}: ${errMsg}`,
        });
        if (res.status === 401 || res.status === 403) {
          result.status = "needs_reconnect";
          await supabaseAdmin
            .from("marketplace_accounts")
            .update({
              status: "needs_reconnect",
              last_orders_sync_status: "needs_reconnect",
              last_orders_sync_error: {
                reason: "fulfillment_unauthorized",
                http: res.status,
              },
            })
            .eq("id", account.id);
        }
        break;
      }

      const orders: any[] = Array.isArray(res.json?.orders) ? res.json.orders : [];
      result.ordersFetched += orders.length;

      for (const order of orders) {
        if (order?.orderPaymentStatus !== "PAID") continue;
        const lineItems: any[] = Array.isArray(order.lineItems) ? order.lineItems : [];
        for (const li of lineItems) {
          result.lineItemsProcessed += 1;
          try {
            const outcome = await processLineItem(
              supabaseAdmin,
              account,
              order,
              li,
              dryRun,
            );
            if (outcome === "recorded") result.salesRecorded += 1;
            else if (outcome === "already") result.alreadyProcessed += 1;
            else if (outcome === "unmatched") result.unmatchedItems += 1;
          } catch (e: any) {
            result.errors.push({
              stage: "process_line_item",
              message: String(e?.message ?? e),
            });
          }
        }
      }

      const total = Number(res.json?.total ?? 0);
      offset += PAGE_LIMIT;
      if (orders.length < PAGE_LIMIT || offset >= total) break;
    }

    // 6. Advance cursor ONLY on full success
    const fullSuccess =
      !hadFetchError && !result.errors.some((e) => e.stage !== "cooldown");
    if (fullSuccess && !dryRun) {
      await supabaseAdmin
        .from("marketplace_accounts")
        .update({
          last_orders_sync_at: endOfWindow.toISOString(),
          last_orders_sync_status: "success",
          last_orders_sync_error: null,
        })
        .eq("id", account.id);
    } else if (!dryRun) {
      await supabaseAdmin
        .from("marketplace_accounts")
        .update({
          last_orders_sync_status:
            result.status === "needs_reconnect" ? "needs_reconnect" : "error",
          last_orders_sync_error: { errors: result.errors.slice(0, 20) },
        })
        .eq("id", account.id);
      if (result.status === "success") result.status = "error";
    }

    return result;
  } finally {
    await supabaseAdmin.rpc("release_orders_sync_lock", {
      _account_id: account.id,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Per line item                                                              */
/* -------------------------------------------------------------------------- */

async function processLineItem(
  supabaseAdmin: any,
  account: any,
  order: any,
  li: any,
  dryRun: boolean,
): Promise<"recorded" | "already" | "unmatched"> {
  const sku: string | null = li?.sku ?? null;
  const legacyItemId: string | null = li?.legacyItemId ?? null;
  const lineItemId: string = String(li?.lineItemId ?? "");
  const orderId: string = String(order?.orderId ?? "");
  if (!orderId || !lineItemId) {
    throw new Error("Missing orderId or lineItemId");
  }

  // Match by SKU first, then legacyItemId; scope to this account.
  let listing: any = null;
  if (sku) {
    const { data } = await supabaseAdmin
      .from("marketplace_listings")
      .select("id, product_id, status")
      .eq("marketplace", "ebay")
      .or(`provider_metadata->>sku.eq.${sku},external_listing_id.eq.${sku}`)
      .limit(1)
      .maybeSingle();
    listing = data ?? null;
  }
  if (!listing && legacyItemId) {
    const { data } = await supabaseAdmin
      .from("marketplace_listings")
      .select("id, product_id, status")
      .eq("marketplace", "ebay")
      .eq("external_listing_id", legacyItemId)
      .limit(1)
      .maybeSingle();
    listing = data ?? null;
  }

  const matched = !!listing;
  const processing_status = matched ? "matched" : "unmatched";

  if (dryRun) {
    return matched ? "recorded" : "unmatched";
  }

  const { data: rpcRes, error } = await supabaseAdmin.rpc(
    "record_marketplace_sale",
    {
      _marketplace_account_id: account.id,
      _marketplace: "ebay",
      _external_order_id: orderId,
      _external_line_item_id: lineItemId,
      _external_listing_id: legacyItemId,
      _sku: sku,
      _quantity: typeof li?.quantity === "number" ? li.quantity : null,
      _order_created_at: order?.creationDate ?? null,
      _order_modified_at: order?.lastModifiedDate ?? null,
      _payment_status: order?.orderPaymentStatus ?? null,
      _fulfillment_status: order?.orderFulfillmentStatus ?? null,
      _processing_status: processing_status,
      _processing_error: null,
      _raw_order_redacted: redactOrder(order),
      _product_id: listing?.product_id ?? null,
      _marketplace_listing_id: listing?.id ?? null,
    },
  );
  if (error) throw error;

  if (rpcRes?.already_processed) return "already";
  return matched ? "recorded" : "unmatched";
}
