import type { MarketplacePublisher, PublishableProduct, PublishResult } from "../types";
import { notImplemented } from "../types";

/**
 * eBay publisher — scaffold only.
 * Real implementation will call eBay's Sell API (POST /sell/inventory/v1/...).
 * No SDK is installed yet on purpose.
 */
export const ebayPublisher: MarketplacePublisher = {
  id: "ebay",
  label: "eBay",
  isConnected: () => false,
  async publish(_product: PublishableProduct): Promise<PublishResult> {
    return notImplemented("eBay");
  },
  async update(_product, _externalListingId): Promise<PublishResult> {
    return notImplemented("eBay");
  },
  async close(_externalListingId): Promise<PublishResult> {
    return notImplemented("eBay");
  },
};
