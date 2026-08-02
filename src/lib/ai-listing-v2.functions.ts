import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ productId: z.string().uuid() });

export type VerificationQuestionV2 = {
  key: string;
  prompt: string;
  reason: string;
  options: string[];
  required: boolean;
};

export type MarketplaceDraftV2 = {
  marketplace: "ebay" | "poshmark" | "depop";
  title: string;
  condition_text: string;
  description: string;
  shipping_text: string;
  listing_price_cents: number | null;
  minimum_offer_cents: number | null;
  buyer_shipping_cents: number | null;
  estimated_buyer_total_cents: number | null;
  price_confidence: "high" | "medium" | "low" | "estimate_only" | "research_required";
  pricing_basis: string;
  keywords: string[];
  validation_flags: string[];
};

export type AiListingV2 = {
  analysisId: string;
  status: "needs_review" | "ready";
  identification: {
    product_name: string;
    brand: string;
    model: string;
    category: string;
    condition: "new" | "like_new" | "very_good" | "good" | "acceptable" | "for_parts";
    condition_grade: string;
    condition_notes: string;
    item_specifics: { name: string; value: string }[];
    confirmed_facts: string[];
    uncertain_claims: string[];
    potentially_valuable: boolean;
  };
  verification_questions: VerificationQuestionV2[];
  quality_flags: string[];
  marketplace_drafts: MarketplaceDraftV2[];
};

const SYSTEM_PROMPT = `You create truthful US resale listings from product photos for a family inventory business.

WORKFLOW GOAL: identify the item, expose uncertainty, then prepare platform-specific draft listings. Never turn an inference into a fact.

GLOBAL RULES:
- Inspect every photo. Confirm facts only when visible or explicitly supplied.
- Never guarantee authenticity, rarity, edition, material, dimensions, functionality, or completeness from appearance alone.
- Put every material uncertainty into uncertain_claims and create a short verification question.
- Questions must be answerable with one mobile tap. Use 2-4 concise options such as Yes/No/Not tested.
- Describe every visible flaw and its location. No marketing fluff.
- All listing copy must be in natural English.
- Stock code is added elsewhere; do not invent one.
- Price is an ESTIMATE, not live market research. Use research_required for jewelry, watches, premium brands, rare collectibles, or unclear models. Never pretend you checked sold listings.

PLATFORM RULES:
- eBay: title <=80 characters; keyword-first. Description <=900 characters. shipping_text must mention ships from Cartersville, Georgia in 2-5 business days. eBay uses FREE SHIPPING, so buyer_shipping_cents=0 and estimated total equals listing price.
- Poshmark: concise, brand/style/size focused; buyer pays shipping. Do not say free shipping.
- Depop: concise and natural; emphasize relevant era/style/aesthetic only when supported. Avoid keyword spam and excessive hashtags.
- Each platform gets its own title and description; do not mechanically copy eBay.
- SALE FAST means a defensible quick-sale estimate. Provide an offer floor only when safe.

QUALITY:
- Add validation_flags for missing measurements, untested function, unclear authenticity, uncertain lot composition, missing package weight, or any rule violation risk.
- If a required question exists, status will be determined by the application as needs_review.

Return strictly the requested JSON schema with exactly ebay, poshmark and depop drafts.`;

const stringArray = { type: "array", items: { type: "string" } };
const nullableMoney = { type: ["integer", "null"], minimum: 0 };
const SCHEMA = {
  type: "object",
  properties: {
    identification: {
      type: "object",
      properties: {
        product_name: { type: "string" },
        brand: { type: "string" },
        model: { type: "string" },
        category: { type: "string" },
        condition: {
          type: "string",
          enum: ["new", "like_new", "very_good", "good", "acceptable", "for_parts"],
        },
        condition_grade: { type: "string" },
        condition_notes: { type: "string" },
        item_specifics: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, value: { type: "string" } },
            required: ["name", "value"],
            additionalProperties: false,
          },
        },
        confirmed_facts: stringArray,
        uncertain_claims: stringArray,
        potentially_valuable: { type: "boolean" },
      },
      required: [
        "product_name",
        "brand",
        "model",
        "category",
        "condition",
        "condition_grade",
        "condition_notes",
        "item_specifics",
        "confirmed_facts",
        "uncertain_claims",
        "potentially_valuable",
      ],
      additionalProperties: false,
    },
    verification_questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          prompt: { type: "string" },
          reason: { type: "string" },
          options: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
          required: { type: "boolean" },
        },
        required: ["key", "prompt", "reason", "options", "required"],
        additionalProperties: false,
      },
    },
    quality_flags: stringArray,
    marketplace_drafts: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          marketplace: { type: "string", enum: ["ebay", "poshmark", "depop"] },
          title: { type: "string" },
          condition_text: { type: "string" },
          description: { type: "string" },
          shipping_text: { type: "string" },
          listing_price_cents: nullableMoney,
          minimum_offer_cents: nullableMoney,
          buyer_shipping_cents: nullableMoney,
          estimated_buyer_total_cents: nullableMoney,
          price_confidence: {
            type: "string",
            enum: ["high", "medium", "low", "estimate_only", "research_required"],
          },
          pricing_basis: { type: "string" },
          keywords: stringArray,
          validation_flags: stringArray,
        },
        required: [
          "marketplace",
          "title",
          "condition_text",
          "description",
          "shipping_text",
          "listing_price_cents",
          "minimum_offer_cents",
          "buyer_shipping_cents",
          "estimated_buyer_total_cents",
          "price_confidence",
          "pricing_basis",
          "keywords",
          "validation_flags",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["identification", "verification_questions", "quality_flags", "marketplace_drafts"],
  additionalProperties: false,
};

function configuredModel() {
  return process.env.AI_LISTING_MODEL?.trim() || "google/gemini-3-flash-preview";
}

async function loadPhotoUrls(supabase: any, productId: string) {
  const { data: photos, error } = await supabase
    .from("product_photos")
    .select("storage_path")
    .eq("product_id", productId)
    .order("position")
    .limit(10);
  if (error) throw new Error(`Cannot load photos: ${error.message}`);
  if (!photos?.length) throw new Error("Add at least one photo before AI analysis.");
  const { data: signed, error: signedError } = await supabase.storage
    .from("product-photos")
    .createSignedUrls(
      photos.map((p: any) => p.storage_path),
      1800,
    );
  if (signedError) throw new Error(`Cannot sign photos: ${signedError.message}`);
  return (signed ?? []).map((x: any) => x.signedUrl).filter(Boolean);
}

async function callGateway(apiKey: string, imageUrls: string[]) {
  const model = configuredModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this product and create the three marketplace drafts.",
              },
              ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "ai_listing_v2", strict: true, schema: SCHEMA },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `AI gateway error ${response.status}: ${(await response.text()).slice(0, 240)}`,
      );
    const raw = await response.json();
    let content = raw?.choices?.[0]?.message?.content ?? "";
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) content = fenced[1];
    return {
      model,
      raw,
      parsed: JSON.parse(content.trim()) as Omit<AiListingV2, "analysisId" | "status">,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const analyzeProductV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<AiListingV2> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");
    const { supabase, userId } = context;
    const imageUrls = await loadPhotoUrls(supabase, data.productId);
    const { model, raw, parsed } = await callGateway(apiKey, imageUrls);
    const questions = Array.isArray(parsed.verification_questions)
      ? parsed.verification_questions
      : [];
    const status = questions.some((q) => q.required) ? "needs_review" : "ready";
    const db = supabase as any;
    const { data: analysis, error } = await db
      .from("ai_product_analyses")
      .insert({
        product_id: data.productId,
        version: 2,
        status,
        model,
        identification: parsed.identification,
        verification_questions: questions,
        quality_flags: parsed.quality_flags ?? [],
        raw_response: raw,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Save AI v2 analysis: ${error.message}`);
    const drafts = (parsed.marketplace_drafts ?? []).filter((d) =>
      ["ebay", "poshmark", "depop"].includes(d.marketplace),
    );
    const { error: draftError } = await db
      .from("ai_marketplace_drafts")
      .insert(
        drafts.map((draft) => ({ ...draft, analysis_id: analysis.id, product_id: data.productId })),
      );
    if (draftError) throw new Error(`Save marketplace drafts: ${draftError.message}`);
    return {
      ...parsed,
      analysisId: analysis.id,
      status,
      verification_questions: questions,
      marketplace_drafts: drafts,
    };
  });
