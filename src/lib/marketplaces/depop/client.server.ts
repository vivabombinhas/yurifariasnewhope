const DEFAULT_TIMEOUT_MS = 20_000;

export type DepopEnvironment = "testing" | "production";

export function getDepopConfig() {
  const environment: DepopEnvironment =
    String(process.env.DEPOP_ENV ?? "testing").toLowerCase() === "production"
      ? "production"
      : "testing";
  return {
    environment,
    apiKey: process.env.DEPOP_API_KEY?.trim() ?? "",
    baseUrl:
      environment === "production"
        ? "https://partnerapi.depop.com"
        : "https://partnerapi-staging.depop.com",
  };
}

export function isDepopConfigured() {
  return !!getDepopConfig().apiKey;
}

export async function depopRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; data: T | null }> {
  const config = getDepopConfig();
  if (!config.apiKey) {
    throw new Error("DEPOP_API_KEY is not configured.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const raw = await response.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw ? { message: raw } : null;
    }
    if (!response.ok) {
      const message =
        data?.message ??
        data?.errors?.[0]?.message ??
        `Depop API returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    return { status: response.status, data: data as T | null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function markDepopProductSoldBySku(sku: string) {
  const normalized = sku.trim();
  if (!normalized) throw new Error("Missing Depop SKU.");
  return depopRequest(`/api/v1/products/by-sku/${encodeURIComponent(normalized)}/mark-as-sold/`, {
    method: "POST",
  });
}
