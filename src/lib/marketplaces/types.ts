/**
 * Marketplace publisher architecture — foundation only.
 *
 * NO real API calls happen here. Each provider returns a `not_implemented`
 * result. The shape is designed so wiring a real SDK later only requires
 * replacing the provider body.
 */

import type { MarketplaceId } from "@/lib/marketplaces";

export type PublishStatus =
  | "not_connected" // provider has no credentials configured
  | "ready"         // can publish, nothing pushed yet
  | "published"     // intent registered (or real listing exists)
  | "error";        // last attempt failed

export type PublishableProduct = {
  id: string;
  sku: string | null;
  title: string;
  description: string;
  price_cents: number | null;
  currency: string;
  condition: string | null;
  brand?: { name: string } | null;
  category?: { name: string } | null;
};

export type PublishResult = {
  ok: boolean;
  status: PublishStatus;
  external_listing_id?: string | null;
  listing_url?: string | null;
  error_message?: string | null;
  /** true while no real integration is wired */
  not_implemented?: boolean;
};

export interface MarketplacePublisher {
  id: MarketplaceId;
  label: string;
  /** Whether credentials/connection are configured for this provider. */
  isConnected(): boolean;
  publish(product: PublishableProduct): Promise<PublishResult>;
  update(product: PublishableProduct, externalListingId: string): Promise<PublishResult>;
  close(externalListingId: string): Promise<PublishResult>;
}

export function notImplemented(label: string): PublishResult {
  return {
    ok: false,
    status: "not_connected",
    not_implemented: true,
    error_message: `${label} integration not implemented yet.`,
  };
}
