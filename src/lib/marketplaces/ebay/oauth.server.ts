/**
 * eBay OAuth helpers — SERVER ONLY.
 * Implements the Auth-Code Grant flow described in eBay's Developer docs.
 * No InventoryItem / Offer / Publish logic here — connection only.
 */

export type EbayEnv = "sandbox" | "production";

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

/**
 * Scopes considered REQUIRED for the app to fully function (write policies, etc).
 * Used by the UI to detect stale connections that need reconnect.
 */
export const EBAY_REQUIRED_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
];

export interface EbayConfig {
  clientId: string;
  clientSecret: string;
  devId: string;
  ruName: string;
  env: EbayEnv;
  stateSecret: string;
}

export function loadEbayConfig(): EbayConfig {
  const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase() as EbayEnv;
  const cfg: EbayConfig = {
    clientId: process.env.EBAY_CLIENT_ID ?? "",
    clientSecret: process.env.EBAY_CLIENT_SECRET ?? "",
    devId: process.env.EBAY_DEV_ID ?? "",
    ruName: process.env.EBAY_RUNAME ?? "",
    env: env === "production" ? "production" : "sandbox",
    stateSecret: process.env.EBAY_OAUTH_STATE_SECRET ?? "",
  };
  const missing = Object.entries({
    EBAY_CLIENT_ID: cfg.clientId,
    EBAY_CLIENT_SECRET: cfg.clientSecret,
    EBAY_DEV_ID: cfg.devId,
    EBAY_RUNAME: cfg.ruName,
    EBAY_OAUTH_STATE_SECRET: cfg.stateSecret,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing eBay secrets: ${missing.join(", ")}`);
  }
  return cfg;
}

export function ebayHosts(env: EbayEnv) {
  if (env === "production") {
    return {
      authorize: "https://auth.ebay.com/oauth2/authorize",
      token: "https://api.ebay.com/identity/v1/oauth2/token",
      identity: "https://apiz.ebay.com/commerce/identity/v1/user/",
    };
  }
  return {
    authorize: "https://auth.sandbox.ebay.com/oauth2/authorize",
    token: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    identity: "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/",
  };
}

// --- HMAC-signed state -----------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const norm = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return b64urlEncode(new Uint8Array(sig));
}

export interface StatePayload {
  uid: string; // user id of the operator who initiated OAuth
  env: EbayEnv;
  nonce: string;
  exp: number; // unix seconds
}

export async function signState(
  payload: StatePayload,
  secret: string,
): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifyState(
  token: string,
  secret: string,
): Promise<StatePayload> {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("Malformed state");
  const expected = await hmac(secret, body);
  // timing-safe comparison
  if (expected.length !== sig.length) throw new Error("Bad state signature");
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (diff !== 0) throw new Error("Bad state signature");
  const payload = JSON.parse(
    new TextDecoder().decode(b64urlDecode(body)),
  ) as StatePayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("State expired");
  }
  return payload;
}

// --- Authorize URL ---------------------------------------------------------

export async function buildAuthorizeUrl(
  cfg: EbayConfig,
  userId: string,
): Promise<{ url: string; state: string }> {
  const state = await signState(
    {
      uid: userId,
      env: cfg.env,
      nonce: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 10 * 60, // 10 min
    },
    cfg.stateSecret,
  );
  const hosts = ebayHosts(cfg.env);
  const url = new URL(hosts.authorize);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", cfg.ruName); // eBay redirect_uri = RuName
  url.searchParams.set("scope", EBAY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "login");
  return { url: url.toString(), state };
}

// --- Token exchange / refresh ---------------------------------------------

export interface EbayTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type: string;
}

function basicAuth(cfg: EbayConfig): string {
  return "Basic " + btoa(`${cfg.clientId}:${cfg.clientSecret}`);
}

async function tokenRequest(
  cfg: EbayConfig,
  body: URLSearchParams,
): Promise<EbayTokenResponse> {
  const hosts = ebayHosts(cfg.env);
  const res = await fetch(hosts.token, {
    method: "POST",
    headers: {
      Authorization: basicAuth(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`eBay token error ${res.status}: ${text}`);
  }
  return JSON.parse(text) as EbayTokenResponse;
}

export function exchangeCodeForTokens(cfg: EbayConfig, code: string) {
  return tokenRequest(
    cfg,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.ruName,
    }),
  );
}

export function refreshAccessToken(cfg: EbayConfig, refreshToken: string) {
  return tokenRequest(
    cfg,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: EBAY_SCOPES.join(" "),
    }),
  );
}

// --- Identity --------------------------------------------------------------

export async function fetchEbayUser(
  cfg: EbayConfig,
  accessToken: string,
): Promise<{ userId?: string; username?: string }> {
  const hosts = ebayHosts(cfg.env);
  const res = await fetch(hosts.identity, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { userId?: string; username?: string };
  return { userId: data.userId, username: data.username };
}
