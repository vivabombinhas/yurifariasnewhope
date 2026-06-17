import type { MarketplacePublisher, PublishableProduct, PublishResult } from "../types";
import { notImplemented } from "../types";

/**
 * Facebook Marketplace publisher — scaffold only.
 * Facebook has no public Marketplace listing API; real implementation will
 * likely rely on Commerce Manager Catalog API or a browser automation flow.
 */
export const facebookPublisher: MarketplacePublisher = {
  id: "facebook_marketplace",
  label: "Facebook Marketplace",
  isConnected: () => false,
  async publish(_product: PublishableProduct): Promise<PublishResult> {
    return notImplemented("Facebook Marketplace");
  },
  async update(_product, _externalListingId): Promise<PublishResult> {
    return notImplemented("Facebook Marketplace");
  },
  async close(_externalListingId): Promise<PublishResult> {
    return notImplemented("Facebook Marketplace");
  },
};
