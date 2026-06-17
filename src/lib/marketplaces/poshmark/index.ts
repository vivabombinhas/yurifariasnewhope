import type { MarketplacePublisher, PublishableProduct, PublishResult } from "../types";
import { notImplemented } from "../types";

/**
 * Poshmark publisher — scaffold only.
 * Poshmark has no public listing API; real implementation will need a
 * partner integration or an automation layer.
 */
export const poshmarkPublisher: MarketplacePublisher = {
  id: "poshmark",
  label: "Poshmark",
  isConnected: () => false,
  async publish(_product: PublishableProduct): Promise<PublishResult> {
    return notImplemented("Poshmark");
  },
  async update(_product, _externalListingId): Promise<PublishResult> {
    return notImplemented("Poshmark");
  },
  async close(_externalListingId): Promise<PublishResult> {
    return notImplemented("Poshmark");
  },
};
