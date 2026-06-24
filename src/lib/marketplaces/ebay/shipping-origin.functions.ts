import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { ShippingOriginView } from "./shipping-origin.server";

export type ShippingOriginDTO =
  | { ok: true; view: ShippingOriginView }
  | { ok: false; errorMessage: string };

export const getEbayShippingOrigin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ShippingOriginDTO> => {
    try {
      const { getShippingOrigin } = await import("./shipping-origin.server");
      const view = await getShippingOrigin(context.supabase);
      return { ok: true, view };
    } catch (e: any) {
      return { ok: false, errorMessage: e?.message ?? String(e) };
    }
  });

const SaveSchema = z.object({
  name: z.string().trim().min(1).max(80),
  addressLine1: z.string().trim().min(1).max(180),
  city: z.string().trim().min(1).max(80),
  stateOrProvince: z.string().trim().min(2).max(40),
  postalCode: z.string().trim().min(3).max(20),
});

export const saveEbayShippingOrigin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SaveSchema.parse(d))
  .handler(async ({ data, context }): Promise<ShippingOriginDTO> => {
    try {
      const { saveShippingOrigin } = await import("./shipping-origin.server");
      const view = await saveShippingOrigin(context.supabase, data);
      return { ok: true, view };
    } catch (e: any) {
      return { ok: false, errorMessage: e?.message ?? String(e) };
    }
  });

export const countActiveEbayListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ count: number }> => {
    const { count, error } = await context.supabase
      .from("marketplace_listings")
      .select("id", { count: "exact", head: true })
      .eq("marketplace", "ebay")
      .eq("status", "active")
      .not("external_listing_id", "is", null);
    if (error) throw error;
    return { count: count ?? 0 };
  });

export interface ApplyResult {
  listingId: string;
  externalListingId: string | null;
  offerId: string | null;
  ok: boolean;
  error?: string;
}

export const applyShippingOriginToActiveListings = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<
      | { ok: true; merchantLocationKey: string; results: ApplyResult[] }
      | { ok: false; errorMessage: string }
    > => {
      try {
        const { requireConfiguredShippingOrigin } = await import(
          "./shipping-origin.server"
        );
        const { setOfferMerchantLocation } = await import(
          "./seller-setup.server"
        );
        const { merchantLocationKey } = await requireConfiguredShippingOrigin(
          context.supabase,
        );

        const { data: rows, error } = await context.supabase
          .from("marketplace_listings")
          .select("id, external_listing_id, provider_metadata")
          .eq("marketplace", "ebay")
          .eq("status", "active")
          .not("external_listing_id", "is", null);
        if (error) throw error;

        const results: ApplyResult[] = [];
        for (const row of (rows ?? []) as any[]) {
          const offerId = (row.provider_metadata ?? {}).offerId ?? null;
          const res: ApplyResult = {
            listingId: row.id,
            externalListingId: row.external_listing_id,
            offerId,
            ok: false,
          };
          if (!offerId) {
            res.error = "Missing offerId in provider_metadata";
            results.push(res);
            continue;
          }
          try {
            await setOfferMerchantLocation(offerId, merchantLocationKey);
            res.ok = true;
          } catch (err: any) {
            res.error = err?.message ?? String(err);
          }
          results.push(res);
        }
        return { ok: true, merchantLocationKey, results };
      } catch (e: any) {
        return { ok: false, errorMessage: e?.message ?? String(e) };
      }
    },
  );
