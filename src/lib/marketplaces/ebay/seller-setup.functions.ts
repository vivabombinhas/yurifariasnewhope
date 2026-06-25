import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SellerSetupStatus, SellerSetupKey } from "./seller-setup.server";

export type SellerSetupDTO =
  | { ok: true; status: SellerSetupStatus }
  | { ok: false; errorMessage: string };

export const getEbaySellerSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<SellerSetupDTO> => {
    try {
      const { inspectSellerSetup } = await import("./seller-setup.server");
      const status = await inspectSellerSetup();
      return { ok: true, status };
    } catch (e: any) {
      return { ok: false, errorMessage: e?.message ?? String(e) };
    }
  });

const RESOURCES = ["location", "fulfillmentPolicy", "paymentPolicy", "returnPolicy"] as const;

export const createEbaySellerResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ resource: z.enum(RESOURCES) }).parse(d))
  .handler(async ({ data }): Promise<SellerSetupDTO> => {
    try {
      const mod = await import("./seller-setup.server");
      switch (data.resource as SellerSetupKey) {
        case "location":
          await mod.createSandboxLocation();
          break;
        case "fulfillmentPolicy":
          await mod.createSandboxFulfillmentPolicy();
          break;
        case "paymentPolicy":
          await mod.createSandboxPaymentPolicy();
          break;
        case "returnPolicy":
          await mod.createSandboxReturnPolicy();
          break;
      }
      const status = await mod.inspectSellerSetup();
      return { ok: true, status };
    } catch (e: any) {
      return { ok: false, errorMessage: e?.message ?? String(e) };
    }
  });

export const syncEbayOfferWithSellerSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; errorMessage: string }> => {
    try {
      const { data: listing, error } = await context.supabase
        .from("marketplace_listings")
        .select("provider_metadata")
        .eq("product_id", data.productId)
        .eq("marketplace", "ebay")
        .maybeSingle();
      if (error) throw error;
      const offerId = (listing?.provider_metadata as { offerId?: string } | null)?.offerId;
      if (!offerId) {
        return { ok: false, errorMessage: "No eBay offer found. Create a draft first." };
      }
      const { ensureValidMerchantLocation, syncOfferWithSellerSetup } = await import("./seller-setup.server");
      const locationInfo = await ensureValidMerchantLocation(context.supabase);
      await syncOfferWithSellerSetup(offerId, locationInfo.merchantLocationKey);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, errorMessage: e?.message ?? String(e) };
    }
  });

export const getEbayOptedInPrograms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<
    | { ok: true; optedIn: boolean; programs: string[]; raw: any }
    | { ok: false; errorMessage: string }
  > => {
    try {
      const { getOptedInPrograms } = await import("./seller-setup.server");
      const r = await getOptedInPrograms();
      return { ok: true, optedIn: r.optedIn, programs: r.programs, raw: r.raw };
    } catch (e: any) {
      return { ok: false, errorMessage: e?.message ?? String(e) };
    }
  });

export const optInEbayBusinessPolicies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<
    | { ok: true; optedIn: boolean; programs: string[]; raw: any }
    | { ok: false; errorMessage: string; raw?: any }
  > => {
    try {
      const mod = await import("./seller-setup.server");
      const result = await mod.optInToBusinessPolicies();
      if (!result.ok) {
        return {
          ok: false,
          errorMessage: `Opt-in failed (HTTP ${result.status})`,
          raw: result.raw,
        };
      }
      const status = await mod.getOptedInPrograms();
      return { ok: true, optedIn: status.optedIn, programs: status.programs, raw: status.raw };
    } catch (e: any) {
      return { ok: false, errorMessage: e?.message ?? String(e) };
    }
  });
