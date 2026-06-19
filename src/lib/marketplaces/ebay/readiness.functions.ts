import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ReadinessStatus = "ok" | "missing" | "warning";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail?: string;
  action?: string;
}

export interface EbayReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
}

import { mapEbayCondition, isShoeCategory } from "./condition-map";

export const checkEbayReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<EbayReadinessResult> => {
    const env = (process.env.EBAY_ENV ?? "sandbox").toLowerCase();
    const checks: ReadinessCheck[] = [];

    const [productRes, photosRes, accountRes] = await Promise.all([
      context.supabase
        .from("products")
        .select(
          "id, title, description, sku, price_cents, condition, ebay_category_id, ebay_aspects",
        )
        .eq("id", data.productId)
        .maybeSingle(),
      context.supabase
        .from("product_photos")
        .select("id", { count: "exact", head: true })
        .eq("product_id", data.productId),
      context.supabase
        .from("marketplace_accounts")
        .select("status")
        .eq("marketplace", "ebay")
        .eq("environment", env)
        .maybeSingle(),
    ]);

    if (productRes.error) throw productRes.error;
    const p = productRes.data;
    if (!p) throw new Error("Product not found");

    // 1. eBay account connected
    checks.push(
      accountRes.data?.status === "connected"
        ? { id: "account", label: "eBay account connected", status: "ok" }
        : {
            id: "account",
            label: "eBay account connected",
            status: "missing",
            action: "Connect eBay in Settings",
          },
    );

    // 2. Title
    const title = (p.title ?? "").trim();
    checks.push(
      title
        ? { id: "title", label: "Title set", status: "ok" }
        : { id: "title", label: "Title set", status: "missing", action: "Add title" },
    );

    // 3. Title <= 80
    checks.push(
      title.length <= 80
        ? { id: "title_len", label: "Title under 80 chars", status: "ok", detail: `${title.length}/80` }
        : {
            id: "title_len",
            label: "Title under 80 chars",
            status: "missing",
            detail: `${title.length}/80`,
            action: "Shorten title",
          },
    );

    // 4. Description
    checks.push(
      (p.description ?? "").trim().length > 0
        ? { id: "description", label: "Description set", status: "ok" }
        : {
            id: "description",
            label: "Description set",
            status: "missing",
            action: "Add description",
          },
    );

    // 5. Price
    checks.push(
      p.price_cents && p.price_cents > 0
        ? { id: "price", label: "Price set", status: "ok" }
        : { id: "price", label: "Price set", status: "missing", action: "Set price" },
    );

    // 6. SKU
    checks.push(
      (p.sku ?? "").trim().length > 0
        ? { id: "sku", label: "SKU set", status: "ok" }
        : { id: "sku", label: "SKU set", status: "missing", action: "Set SKU" },
    );

    // 7. Photos (>=1)
    const photoCount = photosRes.count ?? 0;
    checks.push(
      photoCount > 0
        ? { id: "photos", label: "At least 1 photo", status: "ok", detail: `${photoCount} photo(s)` }
        : { id: "photos", label: "At least 1 photo", status: "missing", action: "Add photos" },
    );

    // 8. Category
    checks.push(
      p.ebay_category_id
        ? { id: "category", label: "eBay category selected", status: "ok" }
        : {
            id: "category",
            label: "eBay category selected",
            status: "missing",
            action: "Select eBay category",
          },
    );

    // 9. Condition mapped
    const ebayCondition = mapEbayCondition(p.condition, p.ebay_category_id);
    const conditionInvalid =
      p.condition && !ebayCondition && isShoeCategory(p.ebay_category_id);
    checks.push(
      ebayCondition
        ? {
            id: "condition",
            label: "Condition mapped to eBay",
            status: "ok",
            detail: ebayCondition,
          }
        : {
            id: "condition",
            label: "Condition mapped to eBay",
            status: "missing",
            action: "Set product condition",
          },
    );

    // 10. quantity = 1 (each item is unique → always ok in this app)
    checks.push({
      id: "quantity",
      label: "Quantity = 1 (unique item)",
      status: "ok",
    });

    // 11+12. Aspects saved + required filled (only if category set + account connected)
    const aspectsObj =
      p.ebay_aspects && typeof p.ebay_aspects === "object" && !Array.isArray(p.ebay_aspects)
        ? (p.ebay_aspects as Record<string, unknown>)
        : {};
    const aspectKeys = Object.keys(aspectsObj);

    checks.push(
      aspectKeys.length > 0
        ? { id: "aspects", label: "Item specifics saved", status: "ok" }
        : {
            id: "aspects",
            label: "Item specifics saved",
            status: "missing",
            action: "Fill item specifics",
          },
    );

    if (p.ebay_category_id && accountRes.data?.status === "connected") {
      try {
        const { getItemAspectsForCategory } = await import("./taxonomy.server");
        const aspects = await getItemAspectsForCategory(p.ebay_category_id);
        const requiredNames = aspects.filter((a) => a.required).map((a) => a.name);
        const missing = requiredNames.filter((name) => {
          const v = aspectsObj[name];
          if (Array.isArray(v)) return !v.some((x) => String(x).trim().length > 0);
          return !v || String(v).trim().length === 0;
        });
        checks.push(
          missing.length === 0
            ? {
                id: "required_aspects",
                label: "All required aspects filled",
                status: "ok",
                detail: `${requiredNames.length} required`,
              }
            : {
                id: "required_aspects",
                label: "All required aspects filled",
                status: "missing",
                detail: `Missing: ${missing.join(", ")}`,
                action: "Fill required aspects",
              },
        );
      } catch (e: any) {
        checks.push({
          id: "required_aspects",
          label: "All required aspects filled",
          status: "warning",
          detail: e?.message ?? "Could not fetch eBay aspects",
        });
      }
    } else {
      checks.push({
        id: "required_aspects",
        label: "All required aspects filled",
        status: "missing",
        action: "Select category and connect eBay first",
      });
    }

    // 13. Image strategy — at least 1 photo is enough as default strategy
    checks.push(
      photoCount > 0
        ? { id: "image_strategy", label: "Image strategy available", status: "ok" }
        : {
            id: "image_strategy",
            label: "Image strategy available",
            status: "missing",
            action: "Add photos",
          },
    );

    const ready = checks.every((c) => c.status === "ok");
    return { ready, checks };
  });
