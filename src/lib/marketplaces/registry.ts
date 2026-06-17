import type { MarketplaceId } from "@/lib/marketplaces";
import type { MarketplacePublisher } from "./types";
import { ebayPublisher } from "./ebay";
import { etsyPublisher } from "./etsy";
import { facebookPublisher } from "./facebook";
import { poshmarkPublisher } from "./poshmark";
import { depopPublisher } from "./depop";

/**
 * Central registry — the ONLY place that maps a MarketplaceId to a publisher.
 * Product code must never import a provider directly; always go through here.
 */
export const PUBLISHERS: Record<MarketplaceId, MarketplacePublisher> = {
  ebay: ebayPublisher,
  etsy: etsyPublisher,
  facebook_marketplace: facebookPublisher,
  poshmark: poshmarkPublisher,
  depop: depopPublisher,
};

export function getPublisher(id: MarketplaceId): MarketplacePublisher {
  return PUBLISHERS[id];
}
