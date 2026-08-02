export type MarketplaceId =
  | "ebay"
  | "etsy"
  | "facebook_marketplace"
  | "poshmark"
  | "depop";

export const MARKETPLACES: {
  id: MarketplaceId;
  label: string;
  sellUrl: string;
}[] = [
  { id: "ebay", label: "eBay", sellUrl: "https://www.ebay.com/sl/sell" },
  { id: "etsy", label: "Etsy", sellUrl: "https://www.etsy.com/your/shops/me/tools/listings/new" },
  { id: "poshmark", label: "Poshmark", sellUrl: "https://poshmark.com/create-listing" },
  { id: "depop", label: "Depop", sellUrl: "https://www.depop.com/products/create/" },
];

export const LISTING_STATUSES = ["draft", "active", "sold", "ended", "removed"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const PRODUCT_STATUSES = [
  "received",
  "photographed",
  "draft",
  "ready_to_list",
  "listed",
  "sold",
  "shipped",
  "archived",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_CONDITIONS = [
  "new",
  "like_new",
  "very_good",
  "good",
  "acceptable",
  "for_parts",
] as const;
export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number];

export function formatStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatPrice(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
