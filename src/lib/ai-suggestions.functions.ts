import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ productId: z.string().uuid() });

const ImproveInput = z.object({
  productId: z.string().uuid(),
  title: z.string().default(""),
  description: z.string().default(""),
  category: z.string().default(""),
  condition: z.string().default(""),
});

export type AiImprovedVariation = {
  label: string;
  title: string;
  description: string;
};

export type AiImprovedListing = {
  variations: AiImprovedVariation[];
};

const IMPROVE_SYSTEM_PROMPT = `You are an experienced US eBay/Marketplace seller. Your job is to take an operator's draft listing and rewrite it so it actually SELLS.

GOAL: produce 3 DISTINCT variations of the same listing so the operator can pick the best one.

VARIATION STRATEGY (use these 3 angles, in this order):
1. label "Keyword-focused" — maximize searchability. Front-load brand/model/type and the most-searched attributes.
2. label "Buyer-benefit" — lead with what the buyer gets / why they'd want it. Still keyword-aware but more human.
3. label "Concise" — shortest viable version. Tight title, 3-4 line description. No filler.

RULES (apply to every variation):
- Write like a confident, experienced reseller. Natural English. No corporate or robotic tone.
- Title: <= 80 chars. No ALL CAPS spam, no emojis.
- Description: 3-7 short lines/paragraphs. End with: "Please review photos carefully before purchasing."
- Do NOT exaggerate. Do NOT invent details not in the draft or clearly visible in photos (no fabricated model numbers, years, materials, sizes).
- Do NOT claim authenticity ("100% genuine", "authentic guaranteed", etc.).
- Do NOT claim "limited edition", "rare", "collectible", or "vintage" unless the draft already states it.
- Avoid overly defensive / disclaimer-heavy language. One short honest condition note is enough.
- Always write in English.
- Preserve facts from the draft (brand, size, color, condition tier). Only rephrase and tighten.

Return strictly the JSON schema. Exactly 3 variations. No prose, no markdown.`;

const IMPROVE_SCHEMA = {
  type: "object",
  properties: {
    variations: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["label", "title", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["variations"],
  additionalProperties: false,
};


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
  // Structured listing fields (used by per-marketplace renderer)
  item_specifics: { name: string; value: string }[];
  condition_grade: string;
  condition_notes: string;
  shipping_notes: string;
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

const SYSTEM_PROMPT = `You are an experienced US eBay/Marketplace reseller writing honest, photo-grounded listings. Look CAREFULLY at every photo before writing — your description MUST reflect what is actually visible, including flaws.

CORE RULES:
- Honesty over polish. NEVER hide damage. If you see chips, cracks, scratches, splits, corner separation, fading, stains, missing parts, scuffs, wear — describe them specifically and WHERE they are (e.g. "top-right corner shows split at the mitered joint", "small chip on the white finish exposing wood underneath").
- Ground every claim in the photos. Do NOT invent dimensions, materials, model numbers, brands, or features that are not visible.
- Confident reseller voice. Natural English. NO marketing fluff ("lovely", "charming", "cozy atmosphere", "touch of farmhouse charm"). Write like someone who actually sells used goods.
- If the item is clearly damaged or worn, the listing must read as an honest as-is sale, not a glamour ad.

OUTPUT FIELDS:

- title: <= 80 chars. Brand (only if visibly printed) + item type + key visible attributes (color, material, size, style). No emojis, no ALL CAPS.

- description: HARD LIMIT 900 characters. TARGET 750-890. Plain text, short paragraphs separated by blank lines. Structure EXACTLY:
  Paragraph 1 — What it is: 1-2 sentences. The item, brand if visible, key visible attributes, intended use. Be specific (e.g. "white wooden 8x10 photo frame distributed by Michaels, currently displaying a nature print").
  Paragraph 2 — Condition: lead with "Condition:" then describe HONESTLY what you see. State the grade (Acceptable / Good / Very Good / Like New) and call out every visible flaw with its location. If there is real damage, say so plainly — do not soften it.
  Paragraph 3 — Shipping & Handling: 1-2 sentences. Brief packaging plan that matches the item's fragility (e.g. "wrapped in bubble wrap with cardboard corner reinforcement, shipped in a sturdy box from the US").
  Closing line: "Please review photos carefully before purchasing."
  Do NOT use bullet lists or key:value pairs inside the description — those belong in item_specifics. Do NOT repeat item_specifics as a list.

- brand: ONLY if clearly visible on the item, label, or packaging. Otherwise "".
- category: short generic marketplace category ("Photo Frame", "Sneakers", "Vintage Lamp").
- condition: one of new, like_new, very_good, good, acceptable, for_parts. Use "acceptable" or "for_parts" when there is structural damage (splits, cracks, missing parts, severe wear).
- tags: 5-10 short lowercase keywords a real buyer would search.
- suggested_price_cents: integer USD cents OR null. Be REALISTIC for the ACTUAL condition — damaged/as-is items are worth little (often $4-$15). If category is potentially valuable (sneakers, designer, watches, trading cards, vintage electronics, fine jewelry) AND brand/model is not clearly readable, set null.

STRUCTURED FIELDS (power the per-marketplace renderer — do NOT duplicate inside description):
- item_specifics: 5-12 {name, value} pairs of attributes actually observed (Brand, Type, Color, Material, Size, Style, Theme, Mounting, Frame Material, Suitable For, etc.). Title Case names. Skip anything you cannot see — never invent.
- condition_grade: short phrase like "Used – Acceptable (visible damage)", "Used – Very Good", "Like New", "New with tags".
- condition_notes: 1-3 short sentences listing observed flaws with locations. Empty string ONLY if the item truly shows no wear.
- shipping_notes: 1-2 short sentences with a packaging plan appropriate to the item.

Keep these MINIMAL (Quick Listing Mode):
- confidence_notes: 1 short sentence or "".
- verification_needed: [].
- possible_brand: "". possible_model: "". visual_clues: []. search_keywords: []. recommended_research_queries: [].
- price_confidence: "high" for ordinary identifiable items, "medium" if generic, "manual_required" only if suggested_price_cents = null.
- potentially_valuable: true only if you set price to null because the category needs research.

Always write in English. Return strictly the JSON schema. No prose, no markdown.`;


const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string", maxLength: 900 },
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
    item_specifics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          value: { type: "string" },
        },
        required: ["name", "value"],
        additionalProperties: false,
      },
    },
    condition_grade: { type: "string" },
    condition_notes: { type: "string" },
    shipping_notes: { type: "string" },
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
    "item_specifics",
    "condition_grade",
    "condition_notes",
    "shipping_notes",
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
        description: (parsed.description ?? "").slice(0, 900),
        verification_needed: Array.isArray(parsed.verification_needed) ? parsed.verification_needed : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        item_specifics: Array.isArray(parsed.item_specifics)
          ? parsed.item_specifics
              .filter((s: any) => s && typeof s.name === "string" && typeof s.value === "string")
              .map((s: any) => ({ name: s.name.trim(), value: s.value.trim() }))
              .filter((s: any) => s.name && s.value)
          : [],
        condition_grade: parsed.condition_grade ?? "",
        condition_notes: parsed.condition_notes ?? "",
        shipping_notes: parsed.shipping_notes ?? "",
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

export const improveListingWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ImproveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");
    const imageUrls = await loadSignedPhotoUrls(supabase, data.productId);

    const userText = `Improve this draft listing. Keep facts from the draft; do not invent.

CURRENT TITLE:
${data.title || "(empty)"}

CURRENT DESCRIPTION:
${data.description || "(empty)"}

CATEGORY: ${data.category || "(unspecified)"}
CONDITION: ${data.condition || "(unspecified)"}

Return exactly 3 distinct variations (Keyword-focused, Buyer-benefit, Concise) as JSON.`;

    const { parsed } = await callGateway<AiImprovedListing>(
      apiKey,
      IMPROVE_SYSTEM_PROMPT,
      IMPROVE_SCHEMA,
      "improved_listing",
      userText,
      imageUrls,
    );

    const variations = (Array.isArray(parsed.variations) ? parsed.variations : [])
      .slice(0, 3)
      .map((v) => ({
        label: (v.label ?? "").trim() || "Variation",
        title: (v.title ?? "").trim(),
        description: (v.description ?? "").trim(),
      }));

    return { variations };
  });
