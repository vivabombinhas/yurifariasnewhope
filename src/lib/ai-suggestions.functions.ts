import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ productId: z.string().uuid() });

export type AiSuggestion = {
  title: string;
  description: string;
  brand: string;
  category: string;
  condition:
    | "new"
    | "like_new"
    | "very_good"
    | "good"
    | "acceptable"
    | "for_parts";
  tags: string[];
  suggested_price_cents: number | null;
  confidence_notes: string;
  verification_needed: string[];
};

const SYSTEM_PROMPT = `You are an expert US resale listing assistant for eBay, Etsy, Facebook Marketplace, Poshmark and Depop.
Your job is to write honest, conservative, commercially viable listing drafts based ONLY on what is clearly visible in the provided product photos.

STRICT HONESTY RULES:
- NEVER invent brand, model, size, material, year, authenticity, or condition details that are not clearly visible.
- NEVER name a specific model, sub-line, collaboration, collection, or release (e.g. "Nike Mag", "Air Jordan 1", "Birkin", "Levi's 501", "iPhone 14 Pro") unless that exact name is plainly readable in the photo on a tag, box, or print. If you only see a logo, identify ONLY the brand — never guess the model.
- NEVER claim a product is from a movie, franchise, athlete, designer, era, or limited edition unless that text is explicitly printed and visible.
- When uncertain, use cautious language: "appears to be", "looks like", "please verify". When in doubt, leave the field empty rather than guessing.
- Do NOT use hype words like "rare", "authentic", "perfect", "mint", "genuine", "original", "vintage", "limited", "exclusive" unless there is clear visible evidence (e.g. authenticity card, hologram, dated tag visible in the photo).
- Condition is always a SUGGESTION, never an absolute claim.
- Suggested price is a CONSERVATIVE estimate of US resale value; treat it as a starting point, not a guarantee. If you cannot identify the exact model, price as a generic unbranded/branded item — NOT as a rare collectible.

OUTPUT FIELDS:
- title: short, commercial, US-marketplace friendly. <= 80 chars. Format: Brand (if visible) + Generic item type + Key visible attributes (color, material). NEVER include a model name unless printed in the photo. If brand is unknown, omit it.
- description: honest, objective, ready to paste on eBay/Etsy/Poshmark/Depop/Facebook. 3-7 short lines covering only what is visible. Do NOT mention specific models, releases, or collaborations. Avoid measurements you can't verify. ALWAYS end the description with the line: "Please review photos carefully before purchasing."
- brand: best guess from clearly visible logos/labels, or "" if not clearly visible. Do NOT guess.
- category: short generic category (e.g. "Women's Jacket", "Vintage Lamp", "Sneakers").
- condition: one of new, like_new, very_good, good, acceptable, for_parts — chosen conservatively as a suggestion.
- tags: 5-10 short lowercase search keywords actually supported by what is visible. No invented model names.
- suggested_price_cents: integer USD cents, conservative US resale estimate. null if unsure. This is an estimate only.
- confidence_notes: 2-4 sentences. Explain exactly WHAT you could identify from the photos (e.g. "Swoosh logo visible — likely Nike brand. Model not identifiable from photos."), and WHAT the operator must verify manually (size, exact model, authenticity, defects).
- verification_needed: array of short items the human operator must confirm in person before publishing. Pick from: size, brand, model, condition, authenticity, missing parts, measurements, material, year, defects, completeness. Add others only if clearly relevant.

Write everything in English. Return strictly the JSON schema. No prose, no markdown.`;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    brand: { type: "string" },
    category: { type: "string" },
    condition: {
      type: "string",
      enum: ["new", "like_new", "very_good", "good", "acceptable", "for_parts"],
    },
    tags: { type: "array", items: { type: "string" } },
    suggested_price_cents: { type: ["integer", "null"] },
    confidence_notes: { type: "string" },
    verification_needed: { type: "array", items: { type: "string" } },
  },
  required: [
    "title",
    "description",
    "brand",
    "category",
    "condition",
    "tags",
    "suggested_price_cents",
    "confidence_notes",
    "verification_needed",
  ],
  additionalProperties: false,
};

const AI_TIMEOUT_MS = 45_000;
const AI_SUPPORTED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function isAiSupportedStoragePath(path: string): boolean {
  const ext = path.toLowerCase().split("?")[0].split("#")[0].split(".").pop() ?? "";
  return AI_SUPPORTED_EXTENSIONS.has(ext);
}

export const analyzeProductWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    console.log("[analyze] start productId=", data.productId, "userId=", userId);
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");

    const { data: photos, error: phErr } = await supabase
      .from("product_photos")
      .select("storage_path, position, is_cover")
      .eq("product_id", data.productId)
      .order("position");
    if (phErr) {
      console.error("[analyze] photos query error", phErr);
      throw new Error(`Cannot load product photos: ${phErr.message}`);
    }
    if (!photos || photos.length === 0) {
      throw new Error("This product has no photos. Add at least one photo before analyzing.");
    }
    console.log("[analyze] photo count=", photos.length);

    const { data: signed, error: sErr } = await supabase.storage
      .from("product-photos")
      .createSignedUrls(
        photos.slice(0, 6).map((p) => p.storage_path),
        60 * 30,
      );
    if (sErr) {
      console.error("[analyze] signed url error", sErr);
      throw new Error(`Could not generate photo URLs: ${sErr.message}`);
    }
    const imageUrls = (signed ?? [])
      .map((s) => s.signedUrl)
      .filter((u): u is string => !!u);
    if (!imageUrls.length) throw new Error("Could not load product photos (empty signed URLs).");
    console.log("[analyze] signed urls=", imageUrls.length);

    const model = "google/gemini-2.5-flash";
    const body = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze these product photos and return the listing suggestion JSON.",
            },
            ...imageUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "listing_suggestion",
          strict: true,
          schema: SCHEMA,
        },
      },
    };

    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      console.error("[analyze] gateway fetch failed", e);
      throw new Error(`AI gateway unreachable: ${e?.message ?? e}`);
    }
    if (!res.ok) {
      const txt = await res.text();
      console.error("[analyze] gateway error", res.status, txt);
      if (res.status === 429) throw new Error("AI rate limit reached. Please try again shortly.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
      throw new Error(`AI gateway error ${res.status}: ${txt.slice(0, 300)}`);
    }
    const raw = await res.json();
    let content: string = raw?.choices?.[0]?.message?.content ?? "";
    if (!content) {
      console.error("[analyze] empty content from gateway", JSON.stringify(raw).slice(0, 500));
      throw new Error("AI returned an empty response.");
    }
    // Strip markdown code fences if present
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) content = fenced[1];
    content = content.trim();

    let suggestion: AiSuggestion;
    try {
      suggestion = JSON.parse(content);
    } catch (e) {
      console.error("[analyze] invalid JSON content=", content.slice(0, 500));
      throw new Error("AI returned invalid JSON. Please retry.");
    }
    if (!Array.isArray(suggestion.verification_needed)) suggestion.verification_needed = [];
    if (!Array.isArray(suggestion.tags)) suggestion.tags = [];

    const { error: insErr } = await supabase.from("ai_suggestions").insert({
      product_id: data.productId,
      model,
      raw,
      suggestion,
      created_by: userId,
    });
    if (insErr) {
      console.error("[analyze] insert ai_suggestions failed", insErr);
      // Don't fail the whole call — still return the suggestion to the user
    }

    console.log("[analyze] success");
    return suggestion;
  });
