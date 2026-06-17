import type { MarketplacePublisher, PublishableProduct, PublishResult } from "../types";
import { notImplemented } from "../types";

/**
 * Etsy publisher — scaffold only.
 * Real implementation will call Etsy Open API v3 (POST /shops/{shop_id}/listings).
 */
export const etsyPublisher: MarketplacePublisher = {
  id: "etsy",
  label: "Etsy",
  isConnected: () => false,
  async publish(_product: PublishableProduct): Promise<PublishResult> {
    return notImplemented("Etsy");
  },
  async update(_product, _externalListingId): Promise<PublishResult> {
    return notImplemented("Etsy");
  },
  async close(_externalListingId): Promise<PublishResult> {
    return notImplemented("Etsy");
  },
};
