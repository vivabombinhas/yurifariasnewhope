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
  // Research-enhanced fields (always present, may be empty)
  possible_brand: string;
  possible_model: string;
  visual_clues: string[];
  search_keywords: string[];
  recommended_research_queries: string[];
  price_confidence: "low" | "medium" | "high" | "manual_required";
  potentially_valuable: boolean;
};

export type AiResearchResult = {
  possible_brand: string;
  possible_model: string;
  visual_clues: string[];
  search_keywords: string[];
  recommended_research_queries: string[];
  verification_questions: string[];
  potentially_valuable: boolean;
  value_alert: string;
  manual_research_recommendation: string;
};

const SYSTEM_PROMPT = `You are an expert US resale listing assistant for eBay, Etsy, Facebook Marketplace, Poshmark and Depop.
Your job is to write honest, conservative, commercially viable listing drafts AND to surface useful identification clues for the human operator.

IDENTIFICATION APPROACH (be smart, not generic):
- Look carefully at: visible logos, visible text on tags/tongues/boxes/labels, colors, silhouette, materials, stitching, hardware, style cues, and any unique design details.
- From these clues, propose POSSIBLE brand and POSSIBLE model — clearly labeled as hypotheses, NEVER as confirmed facts.
- Generate concrete search keywords and research queries the operator can paste into Google / eBay sold listings to verify the item.

STRICT HONESTY RULES:
- NEVER state a confirmed brand, model, sub-line, collaboration, collection, release, athlete, designer, era, or limited edition unless that exact name is plainly readable in the photo.
- If you can only see a logo or silhouette, put your guesses in possible_brand / possible_model with hedging language ("possibly", "appears similar to", "please verify").
- Do NOT use hype words ("rare", "authentic", "mint", "genuine", "original", "vintage", "limited", "exclusive", "deadstock") unless visible evidence exists (authenticity card, hologram, dated tag).
- Condition is always a SUGGESTION.

PRICING RULES (very important):
- For ordinary items you can reasonably identify generically, give a CONSERVATIVE US resale estimate in suggested_price_cents.
- If the item looks like a sneaker, collectible, trading card, watch, designer bag, jewelry, electronics, vintage piece, or anything potentially valuable AND you cannot confirm the exact model from the photos: DO NOT guess a low price. Instead set suggested_price_cents = null, set price_confidence = "manual_required", set potentially_valuable = true, and explain in confidence_notes that manual pricing/research is recommended and why.
- price_confidence values: "low" (broad guess), "medium" (confident category, unsure specifics), "high" (clearly identified generic item), "manual_required" (do not auto-price).

OUTPUT FIELDS:
- title: short, commercial, US-marketplace friendly. <= 80 chars. Brand (if clearly visible) + generic item type + key visible attributes. If brand/model unconfirmed, use a generic descriptive title (e.g. "Gold High-Top Sneakers — Brand Unverified").
- description: 3-7 short honest lines covering only what is visible. If item may be valuable but unconfirmed, include a line like "Possible <category>; please verify brand, model, size and authenticity before purchase." Always end with: "Please review photos carefully before purchasing."
- brand: ONLY if clearly visible/printed. Otherwise "".
- category: short generic category (e.g. "Sneakers", "Women's Jacket", "Vintage Lamp").
- condition: one of new, like_new, very_good, good, acceptable, for_parts — conservative suggestion.
- tags: 5-10 short lowercase keywords supported by what is visible.
- suggested_price_cents: integer USD cents OR null (see PRICING RULES).
- confidence_notes: 2-5 sentences. State exactly what visible clues you used, what you could and could NOT identify, and why pricing is or is not manual.
- verification_needed: short items the operator must confirm in person (size, brand, model, authenticity, defects, measurements, completeness, year, material).
- possible_brand: best hypothesis, hedged ("" if no clue).
- possible_model: best hypothesis, hedged ("" if no clue).
- visual_clues: short bullet phrases of what you actually saw (e.g. "metallic gold finish", "high-top silhouette", "visible tongue text", "chunky rubber sole").
- search_keywords: short phrases the operator can paste into Google/eBay to research (e.g. "gold metallic high top sneakers", "high top sneaker gold tongue logo").
- recommended_research_queries: 3-6 full natural-language queries (e.g. "eBay sold gold high top metallic sneakers size 10", "identify high top sneaker with gold tongue").
- price_confidence: see above.
- potentially_valuable: true if item belongs to a category that is frequently valuable when authenticated (sneakers, designer, watches, trading cards, vintage electronics, collectibles).

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
    possible_brand: { type: "string" },
    possible_model: { type: "string" },
    visual_clues: { type: "array", items: { type: "string" } },
    search_keywords: { type: "array", items: { type: "string" } },
    recommended_research_queries: { type: "array", items: { type: "string" } },
    price_confidence: {
      type: "string",
      enum: ["low", "medium", "high", "manual_required"],
    },
    potentially_valuable: { type: "boolean" },
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
    "possible_brand",
    "possible_model",
    "visual_clues",
    "search_keywords",
    "recommended_research_queries",
    "price_confidence",
    "potentially_valuable",
  ],
  additionalProperties: false,
};

const RESEARCH_SYSTEM_PROMPT = `You are a resale research assistant. The operator already has product photos and wants help identifying the item before pricing it.
Your job is NOT to write a listing. Your job is to surface IDENTIFICATION CLUES and RESEARCH GUIDANCE so the operator can confirm the item manually.

STRICT RULES:
- NEVER confirm brand, model, edition, authenticity, or value. Always hedge ("possibly", "appears similar to", "please verify").
- Never claim the item is rare, authentic, limited, or valuable as fact. You may FLAG that the category is often valuable so a human checks.
- Output is for human research, not for publishing.

Examine: visible logos, visible text, colors, silhouette, materials, hardware, stitching, sole, tags, boxes, unique details.

OUTPUT FIELDS:
- possible_brand: hedged best guess or "".
- possible_model: hedged best guess or "".
- visual_clues: short phrases of what you actually saw.
- search_keywords: short keyword phrases for Google/eBay.
- recommended_research_queries: 4-8 full natural-language search queries.
- verification_questions: 3-6 questions the operator should answer in person (size on tag, made-in country, serial number, box label, authenticity card, weight/feel, sole stamp, etc.).
- potentially_valuable: true if the category is frequently valuable (sneakers, designer bags, watches, trading cards, vintage electronics, collectibles, fine jewelry).
- value_alert: short sentence explaining why this MIGHT be valuable and what to check, or "" if not applicable.
- manual_research_recommendation: 1-3 sentences telling the operator how to research and price safely (e.g. "Check eBay 'sold' listings using these queries before pricing. Do not assume rarity. If authenticity is uncertain, list as 'unauthenticated' or pass.").

Return strictly the JSON schema. No prose, no markdown.`;

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    possible_brand: { type: "string" },
    possible_model: { type: "string" },
    visual_clues: { type: "array", items: { type: "string" } },
    search_keywords: { type: "array", items: { type: "string" } },
    recommended_research_queries: { type: "array", items: { type: "string" } },
    verification_questions: { type: "array", items: { type: "string" } },
    potentially_valuable: { type: "boolean" },
    value_alert: { type: "string" },
    manual_research_recommendation: { type: "string" },
  },
  required: [
    "possible_brand",
    "possible_model",
    "visual_clues",
    "search_keywords",
    "recommended_research_queries",
    "verification_questions",
    "potentially_valuable",
    "value_alert",
    "manual_research_recommendation",
  ],
  additionalProperties: false,
};

const AI_TIMEOUT_MS = 45_000;
const AI_SUPPORTED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function isAiSupportedStoragePath(path: string): boolean {
  const ext = path.toLowerCase().split("?")[0].split("#")[0].split(".").pop() ?? "";
  return AI_SUPPORTED_EXTENSIONS.has(ext);
}

async function loadSignedPhotoUrls(
  supabase: any,
  productId: string,
): Promise<string[]> {
  const { data: photos, error: phErr } = await supabase
    .from("product_photos")
    .select("storage_path, position, is_cover")
    .eq("product_id", productId)
    .order("position");
  if (phErr) throw new Error(`Cannot load product photos: ${phErr.message}`);
  if (!photos || photos.length === 0) {
    throw new Error("This product has no photos. Add at least one photo before analyzing.");
  }
  const unsupported = photos.filter((p: any) => !isAiSupportedStoragePath(p.storage_path));
  if (unsupported.length > 0) {
    throw new Error(
      "This image format is not supported for AI analysis. Please re-upload the photo as JPEG, PNG, WebP, or GIF.",
    );
  }
  const { data: signed, error: sErr } = await supabase.storage
    .from("product-photos")
    .createSignedUrls(
      photos.slice(0, 6).map((p: any) => p.storage_path),
      60 * 30,
    );
  if (sErr) throw new Error(`Could not generate photo URLs: ${sErr.message}`);
  const urls = (signed ?? [])
    .map((s: any) => s.signedUrl)
    .filter((u: any): u is string => !!u);
  if (!urls.length) throw new Error("Could not load product photos (empty signed URLs).");
  return urls;
}

async function callGateway<T>(
  apiKey: string,
  systemPrompt: string,
  schema: object,
  schemaName: string,
  userText: string,
  imageUrls: string[],
): Promise<{ raw: any; parsed: T; model: string }> {
  const model = "google/gemini-2.5-flash";
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          ...imageUrls.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    },
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("AI analysis timed out. Please try again with fewer photos or smaller images.");
    }
    throw new Error(`AI gateway unreachable: ${e?.message ?? e}`);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 429) throw new Error("AI rate limit reached. Please try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
    throw new Error(`AI gateway error ${res.status}: ${txt.slice(0, 300)}`);
  }
  const raw = await res.json();
  let content: string = raw?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("AI returned an empty response.");
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) content = fenced[1];
  content = content.trim();
  let parsed: T;
  try {
    parsed = JSON.parse(content) as T;
  } catch {
    throw new Error("AI returned invalid JSON. Please retry.");
  }
  return { raw, parsed, model };
}

export const analyzeProductWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    const startedAt = Date.now();
    console.log("[analyze] start productId=", data.productId, "userId=", userId);
    try {
      if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");
      const imageUrls = await loadSignedPhotoUrls(supabase, data.productId);
      console.log("[analyze] signed urls=", imageUrls.length);

      const { raw, parsed, model } = await callGateway<AiSuggestion>(
        apiKey,
        SYSTEM_PROMPT,
        SCHEMA,
        "listing_suggestion",
        "Analyze these product photos and return the listing suggestion JSON. Use the research-enhanced reasoning described in the system prompt.",
        imageUrls,
      );

      const suggestion: AiSuggestion = {
        ...parsed,
        verification_needed: Array.isArray(parsed.verification_needed) ? parsed.verification_needed : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        visual_clues: Array.isArray(parsed.visual_clues) ? parsed.visual_clues : [],
        search_keywords: Array.isArray(parsed.search_keywords) ? parsed.search_keywords : [],
        recommended_research_queries: Array.isArray(parsed.recommended_research_queries)
          ? parsed.recommended_research_queries
          : [],
        possible_brand: parsed.possible_brand ?? "",
        possible_model: parsed.possible_model ?? "",
        price_confidence: parsed.price_confidence ?? "low",
        potentially_valuable: !!parsed.potentially_valuable,
      };

      // Safety net: if model flagged manual pricing or potentially valuable without confirmed brand, null out price.
      if (
        suggestion.price_confidence === "manual_required" ||
        (suggestion.potentially_valuable && !suggestion.brand)
      ) {
        suggestion.suggested_price_cents = null;
      }

      const { error: insErr } = await supabase.from("ai_suggestions").insert({
        product_id: data.productId,
        model,
        raw,
        suggestion,
        created_by: userId,
      });
      if (insErr) console.error("[analyze] insert ai_suggestions failed", insErr);

      console.log("[analyze] success durationMs=", Date.now() - startedAt);
      return suggestion;
    } catch (e: any) {
      console.error("[analyze] failed durationMs=", Date.now() - startedAt, e);
      if (e?.name === "AbortError") {
        throw new Error("AI analysis timed out. Please try again with fewer photos or smaller images.");
      }
      throw e;
    } finally {
      console.log("[analyze] finished productId=", data.productId, "durationMs=", Date.now() - startedAt);
    }
  });

export const researchProductWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    const startedAt = Date.now();
    console.log("[research] start productId=", data.productId, "userId=", userId);
    try {
      if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");
      const imageUrls = await loadSignedPhotoUrls(supabase, data.productId);

      const { parsed } = await callGateway<AiResearchResult>(
        apiKey,
        RESEARCH_SYSTEM_PROMPT,
        RESEARCH_SCHEMA,
        "research_result",
        "Examine these product photos and return identification clues and research guidance (no listing copy, no confirmed claims).",
        imageUrls,
      );

      const result: AiResearchResult = {
        ...parsed,
        visual_clues: Array.isArray(parsed.visual_clues) ? parsed.visual_clues : [],
        search_keywords: Array.isArray(parsed.search_keywords) ? parsed.search_keywords : [],
        recommended_research_queries: Array.isArray(parsed.recommended_research_queries)
          ? parsed.recommended_research_queries
          : [],
        verification_questions: Array.isArray(parsed.verification_questions)
          ? parsed.verification_questions
          : [],
        possible_brand: parsed.possible_brand ?? "",
        possible_model: parsed.possible_model ?? "",
        value_alert: parsed.value_alert ?? "",
        manual_research_recommendation: parsed.manual_research_recommendation ?? "",
        potentially_valuable: !!parsed.potentially_valuable,
      };

      console.log("[research] success durationMs=", Date.now() - startedAt);
      return result;
    } catch (e: any) {
      console.error("[research] failed durationMs=", Date.now() - startedAt, e);
      if (e?.name === "AbortError") {
        throw new Error("AI research timed out. Please try again with fewer photos or smaller images.");
      }
      throw e;
    } finally {
      console.log("[research] finished productId=", data.productId, "durationMs=", Date.now() - startedAt);
    }
  });
