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
};

const SYSTEM_PROMPT = `You are an expert US resale listing assistant for eBay, Etsy, Facebook Marketplace, Poshmark and Depop.
Analyze ONLY what is visible in the provided product photos. Never invent brand, size, materials, defects, or features that cannot be seen.
Write everything in English. Be clear, honest, and commercially appealing — no hype, no false claims.
- title: <= 80 chars, keyword-rich, search-friendly. Format: Brand + Item + Key attributes.
- description: 3-6 short lines covering visible condition, materials, notable details. No measurements you can't verify.
- brand: best guess from visible logos/labels, or "" if unknown.
- category: short generic category (e.g. "Women's Jacket", "Vintage Lamp", "Sneakers").
- condition: pick one of: new, like_new, very_good, good, acceptable, for_parts.
- tags: 5-10 short lowercase search keywords.
- suggested_price_cents: integer USD cents, conservative US resale market estimate. null if unsure.
- confidence_notes: 1-2 sentences explaining uncertainty or what the seller should double-check.
Return strictly the JSON schema. No prose, no markdown.`;

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
  ],
  additionalProperties: false,
};

export const analyzeProductWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const { data: photos, error: phErr } = await supabase
      .from("product_photos")
      .select("storage_path, position, is_cover")
      .eq("product_id", data.productId)
      .order("position");
    if (phErr) throw phErr;
    if (!photos || photos.length === 0) {
      throw new Error("This product has no photos. Add at least one photo before analyzing.");
    }

    const { data: signed, error: sErr } = await supabase.storage
      .from("product-photos")
      .createSignedUrls(
        photos.slice(0, 6).map((p) => p.storage_path),
        60 * 30,
      );
    if (sErr) throw sErr;
    const imageUrls = (signed ?? [])
      .map((s) => s.signedUrl)
      .filter((u): u is string => !!u);
    if (!imageUrls.length) throw new Error("Could not load product photos.");

    const model = "google/gemini-3-flash-preview";
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

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 429) throw new Error("AI rate limit reached. Please try again shortly.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
      throw new Error(`AI gateway error ${res.status}: ${txt.slice(0, 300)}`);
    }
    const raw = await res.json();
    const content: string = raw?.choices?.[0]?.message?.content ?? "";
    let suggestion: AiSuggestion;
    try {
      suggestion = JSON.parse(content);
    } catch {
      throw new Error("AI returned invalid JSON.");
    }

    await supabase.from("ai_suggestions").insert({
      product_id: data.productId,
      model,
      raw,
      suggestion,
      created_by: userId,
    });

    return suggestion;
  });
