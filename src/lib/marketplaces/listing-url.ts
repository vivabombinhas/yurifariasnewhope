import type { MarketplaceId } from "../marketplaces";

export type NormalizedListingUrl = {
  url: string;
  externalListingId: string;
};

const HOSTS: Partial<Record<MarketplaceId, ReadonlySet<string>>> = {
  poshmark: new Set(["poshmark.com", "www.poshmark.com"]),
  depop: new Set(["depop.com", "www.depop.com"]),
};

const PATH_PREFIX: Partial<Record<MarketplaceId, string>> = {
  poshmark: "/listing/",
  depop: "/products/",
};

export function normalizeListingUrl(
  marketplace: MarketplaceId,
  rawUrl: string,
): NormalizedListingUrl {
  const allowedHosts = HOSTS[marketplace];
  const pathPrefix = PATH_PREFIX[marketplace];
  if (!allowedHosts || !pathPrefix) {
    throw new Error(`Listing URL validation is not configured for ${marketplace}.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid listing URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || !allowedHosts.has(hostname)) {
    throw new Error(`Enter a valid ${marketplace === "poshmark" ? "Poshmark" : "Depop"} URL.`);
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (!pathname.toLowerCase().startsWith(pathPrefix) || pathname === pathPrefix.slice(0, -1)) {
    throw new Error("The URL must point directly to a product listing.");
  }

  const externalListingId = decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? "");
  if (!externalListingId) throw new Error("Could not identify the listing from this URL.");

  parsed.hostname = hostname.replace(/^www\./, "");
  parsed.pathname = pathname;
  parsed.search = "";
  parsed.hash = "";

  return { url: parsed.toString(), externalListingId };
}
