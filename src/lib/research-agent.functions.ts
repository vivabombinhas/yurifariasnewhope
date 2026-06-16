import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Research Agent — foundation only.
 *
 * Takes the output of Analyze + Improve with Research and produces a
 * structured identification report (top hypotheses, confidence, price
 * range, sale keywords, research queries, verification checklist).
 *
 * It does NOT call eBay / Google / StockX / GOAT yet. The response shape
 * is designed so a future executor can fan out to those sources using
 * `external_search_targets` and `search_queries`.
 */

export type ResearchHypothesis = {
  rank: number;
  label: string;                       // human-readable identification, e.g. "Nike Dunk Low — Panda (2021)"
  possible_brand: string;
  possible_model: string;
  category_hint: string;               // e.g. "Sneakers", "Trading Card", "Designer Bag"
  era_or_release_hint: string;         // hedged, may be ""
  confidence: number;                  // 0..1
  confidence_band: "low" | "medium" | "high";
  rationale: string;                   // short, references which visual_clues led here
  supporting_clues: string[];          // subset of visual_clues that support this hypothesis
  conflicting_clues: string[];         // visual_clues that argue against this hypothesis
  estimated_price_range_usd: {
    low: number | null;
    high: number | null;
    currency: "USD";
    basis: string;                     // e.g. "typical eBay sold range for generic gold high-top sneakers"
    is_estimate_only: boolean;         // always true at this stage
  };
  verification_checklist: string[];    // physical checks operator must do to confirm THIS hypothesis
  external_search_targets: ExternalSearchTarget[];
};

export type ExternalSearchTarget = {
  source:
    | "ebay_sold"
    | "google_search"
    | "google_lens"
    | "stockx"
    | "goat"
    | "collectibles_marketplace";
  query: string;                       // ready-to-paste query
  url: string;                         // deep link (no API call performed)
  intent: string;                      // why we'd run this search
};

export type ResearchAgentReport = {
  product_id: string;
  generated_at: string;                // ISO
  input_summary: {
    title: string;
    description: string;
    possible_brand: string;
    possible_model: string;
    visual_clues: string[];
    search_keywords: string[];
  };
  hypotheses: ResearchHypothesis[];    // up to 5
  global_sale_keywords: string[];      // resale-friendly keywords across hypotheses
  global_search_queries: string[];     // ready-to-paste research queries
  global_verification_checklist: string[];
  cross_source_strategy: string;       // narrative: how to use these sources together
  safety_notes: string;                // hedging / authenticity warnings
  ready_for_external_lookup: boolean;  // true if hypotheses + queries are usable by a future executor
};

const Input = z.object({
  productId: z.string().uuid(),
  // Optional client-side overrides. If omitted we read latest ai_suggestions row.
  title: z.string().optional(),
  description: z.string().optional(),
  visual_clues: z.array(z.string()).optional(),
  possible_brand: z.string().optional(),
  possible_model: z.string().optional(),
  search_keywords: z.array(z.string()).optional(),
});

const SYSTEM_PROMPT = `You are a senior US resale RESEARCH AGENT.
You receive an AI-generated listing draft and identification clues for a single physical product.
Your job is to produce a STRUCTURED IDENTIFICATION REPORT to guide a human operator (and a future automated executor) toward a confident identification and a defensible resale price range.

You DO NOT browse the web. You DO NOT confirm authenticity, model, or limited-edition status. You GENERATE HYPOTHESES and the EXACT QUERIES a human (or a future tool) should run on:
- eBay sold/completed listings
- Google web search
- Google Lens (reverse image)
- StockX (sneakers/streetwear/collectibles)
- GOAT (sneakers/apparel)
- collectibles marketplaces (TCG, watches, vintage, etc.) — generic

RULES:
- Produce up to 5 ranked hypotheses, most likely first.
- Each hypothesis includes hedged brand/model, category_hint, supporting_clues (from the provided visual_clues), conflicting_clues, a confidence in [0,1], confidence_band, and rationale.
- estimated_price_range_usd is ALWAYS an estimate. If you cannot estimate safely (potentially valuable item without confirmed model), set low=null, high=null and is_estimate_only=true, and explain in basis.
- verification_checklist must be physical checks the operator can perform in person to confirm THAT specific hypothesis (tag text, stitching, sole stamp, serial, weight, materials, box label, holograms, etc.).
- For each hypothesis, build external_search_targets with ready-to-paste queries. The URL must be a deep link to the source's search page with the query encoded — but you do NOT need to execute or validate it.
- global_sale_keywords are resale-optimized keywords (US English) usable as eBay title tokens.
- global_search_queries are 4-8 high-signal queries across hypotheses.
- global_verification_checklist consolidates physical checks common to top hypotheses.
- cross_source_strategy explains in 2-4 sentences how to combine these sources (e.g. "Use Google Lens first, then narrow on eBay sold, then confirm pricing on StockX/GOAT for sneakers").
- safety_notes restates honesty rules: never claim authenticity, rare, limited, or deadstock without physical confirmation.
- ready_for_external_lookup = true when queries and targets are concrete enough for a future executor to call.

Return STRICT JSON matching the schema. No prose, no markdown.`;

const HYPOTHESIS_SCHEMA = {
  type: "object",
  properties: {
    rank: { type: "integer" },
    label: { type: "string" },
    possible_brand: { type: "string" },
    possible_model: { type: "string" },
    category_hint: { type: "string" },
    era_or_release_hint: { type: "string" },
    confidence: { type: "number" },
    confidence_band: { type: "string", enum: ["low", "medium", "high"] },
    rationale: { type: "string" },
    supporting_clues: { type: "array", items: { type: "string" } },
    conflicting_clues: { type: "array", items: { type: "string" } },
    estimated_price_range_usd: {
      type: "object",
      properties: {
        low: { type: ["number", "null"] },
        high: { type: ["number", "null"] },
        currency: { type: "string", enum: ["USD"] },
        basis: { type: "string" },
        is_estimate_only: { type: "boolean" },
      },
      required: ["low", "high", "currency", "basis", "is_estimate_only"],
      additionalProperties: false,
    },
    verification_checklist: { type: "array", items: { type: "string" } },
    external_search_targets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: [
              "ebay_sold",
              "google_search",
              "google_lens",
              "stockx",
              "goat",
              "collectibles_marketplace",
            ],
          },
          query: { type: "string" },
          url: { type: "string" },
          intent: { type: "string" },
        },
        required: ["source", "query", "url", "intent"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "rank",
    "label",
    "possible_brand",
    "possible_model",
    "category_hint",
    "era_or_release_hint",
    "confidence",
    "confidence_band",
    "rationale",
    "supporting_clues",
    "conflicting_clues",
    "estimated_price_range_usd",
    "verification_checklist",
    "external_search_targets",
  ],
  additionalProperties: false,
};

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    hypotheses: { type: "array", items: HYPOTHESIS_SCHEMA },
    global_sale_keywords: { type: "array", items: { type: "string" } },
    global_search_queries: { type: "array", items: { type: "string" } },
    global_verification_checklist: { type: "array", items: { type: "string" } },
    cross_source_strategy: { type: "string" },
    safety_notes: { type: "string" },
    ready_for_external_lookup: { type: "boolean" },
  },
  required: [
    "hypotheses",
    "global_sale_keywords",
    "global_search_queries",
    "global_verification_checklist",
    "cross_source_strategy",
    "safety_notes",
    "ready_for_external_lookup",
  ],
  additionalProperties: false,
};

const TIMEOUT_MS = 45_000;

function buildDeepLink(source: ExternalSearchTarget["source"], query: string): string {
  const q = encodeURIComponent(query);
  switch (source) {
    case "ebay_sold":
      return `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1`;
    case "google_search":
      return `https://www.google.com/search?q=${q}`;
    case "google_lens":
      // Lens has no public query param; operator uploads the photo manually.
      return `https://lens.google.com/`;
    case "stockx":
      return `https://stockx.com/search?s=${q}`;
    case "goat":
      return `https://www.goat.com/search?query=${q}`;
    case "collectibles_marketplace":
      return `https://www.ebay.com/sch/i.html?_nkw=${q}&_sacat=1`;
  }
}

async function callGateway(apiKey: string, userPayload: object) {
  const body = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Build the structured research report for this product.\n\nINPUT:\n" +
              JSON.stringify(userPayload, null, 2),
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "research_agent_report", strict: true, schema: REPORT_SCHEMA },
    },
  };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
      throw new Error("Research Agent timed out. Please retry.");
    }
    throw new Error(`AI gateway unreachable: ${e?.message ?? e}`);
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 429) throw new Error("AI rate limit reached. Please retry shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
    throw new Error(`AI gateway error ${res.status}: ${txt.slice(0, 300)}`);
  }
  const raw = await res.json();
  let content: string = raw?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("Research Agent returned empty response.");
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) content = fenced[1];
  try {
    return JSON.parse(content.trim());
  } catch {
    throw new Error("Research Agent returned invalid JSON. Please retry.");
  }
}

export const runResearchAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<ResearchAgentReport> => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");
    const startedAt = Date.now();
    console.log("[research-agent] start productId=", data.productId);

    // Load latest suggestion as fallback context
    const { data: latest } = await supabase
      .from("ai_suggestions")
      .select("suggestion")
      .eq("product_id", data.productId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const last: any = latest?.suggestion ?? {};

    const input_summary = {
      title: data.title ?? last.title ?? "",
      description: data.description ?? last.description ?? "",
      possible_brand: data.possible_brand ?? last.possible_brand ?? "",
      possible_model: data.possible_model ?? last.possible_model ?? "",
      visual_clues: data.visual_clues ?? last.visual_clues ?? [],
      search_keywords: data.search_keywords ?? last.search_keywords ?? [],
    };

    if (
      !input_summary.title &&
      !input_summary.description &&
      input_summary.visual_clues.length === 0
    ) {
      throw new Error(
        "Run Analyze with AI (and optionally Improve with Research) before the Research Agent.",
      );
    }

    const parsed = await callGateway(apiKey, input_summary);

    // Normalize, rebuild deep links server-side to guarantee correctness,
    // and clamp to 5 hypotheses.
    const hypotheses: ResearchHypothesis[] = (Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [])
      .slice(0, 5)
      .map((h: any, idx: number) => {
        const targets: ExternalSearchTarget[] = (Array.isArray(h.external_search_targets)
          ? h.external_search_targets
          : []
        ).map((t: any) => ({
          source: t.source,
          query: String(t.query ?? "").slice(0, 240),
          intent: String(t.intent ?? ""),
          url: buildDeepLink(t.source, String(t.query ?? "")),
        }));
        const confidence = Math.max(0, Math.min(1, Number(h.confidence ?? 0)));
        return {
          rank: Number(h.rank ?? idx + 1),
          label: String(h.label ?? ""),
          possible_brand: String(h.possible_brand ?? ""),
          possible_model: String(h.possible_model ?? ""),
          category_hint: String(h.category_hint ?? ""),
          era_or_release_hint: String(h.era_or_release_hint ?? ""),
          confidence,
          confidence_band: (["low", "medium", "high"].includes(h.confidence_band)
            ? h.confidence_band
            : confidence >= 0.7
            ? "high"
            : confidence >= 0.4
            ? "medium"
            : "low") as ResearchHypothesis["confidence_band"],
          rationale: String(h.rationale ?? ""),
          supporting_clues: Array.isArray(h.supporting_clues) ? h.supporting_clues : [],
          conflicting_clues: Array.isArray(h.conflicting_clues) ? h.conflicting_clues : [],
          estimated_price_range_usd: {
            low: h.estimated_price_range_usd?.low ?? null,
            high: h.estimated_price_range_usd?.high ?? null,
            currency: "USD",
            basis: String(h.estimated_price_range_usd?.basis ?? ""),
            is_estimate_only: true,
          },
          verification_checklist: Array.isArray(h.verification_checklist)
            ? h.verification_checklist
            : [],
          external_search_targets: targets,
        };
      });

    const report: ResearchAgentReport = {
      product_id: data.productId,
      generated_at: new Date().toISOString(),
      input_summary,
      hypotheses,
      global_sale_keywords: Array.isArray(parsed.global_sale_keywords)
        ? parsed.global_sale_keywords
        : [],
      global_search_queries: Array.isArray(parsed.global_search_queries)
        ? parsed.global_search_queries
        : [],
      global_verification_checklist: Array.isArray(parsed.global_verification_checklist)
        ? parsed.global_verification_checklist
        : [],
      cross_source_strategy: String(parsed.cross_source_strategy ?? ""),
      safety_notes: String(
        parsed.safety_notes ??
          "Hypotheses only. Do not claim authenticity, rarity, or limited edition without physical verification.",
      ),
      ready_for_external_lookup: !!parsed.ready_for_external_lookup && hypotheses.length > 0,
    };

    console.log("[research-agent] success durationMs=", Date.now() - startedAt, "hypotheses=", hypotheses.length);
    return report;
  });
