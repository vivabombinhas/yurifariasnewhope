import type { MarketplacePublisher, PublishableProduct, PublishResult } from "../types";
import { notImplemented } from "../types";

/**
 * Depop publisher — scaffold only.
 * Depop has no public listing API; real implementation will need a
 * partner integration or an automation layer.
 */
export const depopPublisher: MarketplacePublisher = {
  id: "depop",
  label: "Depop",
  isConnected: () => false,
  async publish(_product: PublishableProduct): Promise<PublishResult> {
    return notImplemented("Depop");
  },
  async update(_product, _externalListingId): Promise<PublishResult> {
    return notImplemented("Depop");
  },
  async close(_externalListingId): Promise<PublishResult> {
    return notImplemented("Depop");
  },
};
