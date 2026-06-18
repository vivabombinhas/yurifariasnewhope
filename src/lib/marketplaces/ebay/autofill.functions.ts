import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface EbayAspectAutofillSuggestion {
  name: string;
  values: string[];
  confidence: "high" | "medium" | "low";
  source?: "product" | "ai";
}

export interface EbayAspectAutofillResult {
  suggestions: EbayAspectAutofillSuggestion[];
  notes?: string;
  fromProduct: number;
  fromAi: number;
}


const Input = z.object({
  productId: z.string().uuid(),
  categoryId: z.string().min(1),
  categoryName: z.string().optional(),
  aspects: z
    .array(
      z.object({
        name: z.string(),
        required: z.boolean(),
        mode: z.string(),
        cardinality: z.string(),
        dataType: z.string(),
        values: z.array(z.string()).default([]),
      }),
    )
    .max(80),
});

const SYSTEM_PROMPT = `You are an experienced US eBay reseller filling in Item Specifics for a product listing.

You will receive:
- product context (title, description, brand, category, condition, tags, item_specifics already entered)
- the eBay category that was picked
- the list of eBay aspects (name, required/recommended/optional, allowed values if any)

Your job: return values you can infer with HIGH confidence from the product context.

STRICT RULES:
- NEVER invent brands, model numbers, sizes, measurements (width/height/length/depth), capacity, materials, or years.
- If the aspect has a fixed list of allowed values, you MUST pick one that exists in that list — never a free-text variant.
- If you are not confident, OMIT the aspect entirely. Do not return empty strings, "Unknown", "N/A", "Various", or guesses.
- Prefer concrete attributes that are clearly stated in the title/description/tags (e.g., color, brand if shown, department if obvious like "men's shoes", style/type if obvious).
- For shoes: only fill US Shoe Size if it is explicitly stated in the product. Never guess.
- For clothing/shoes: Department is OK if the title clearly indicates gender (Men/Women/Unisex/Kids). Otherwise omit.
- Confidence: "high" only when the value is explicitly stated or visually obvious from a confirmed photo description. "medium" when strongly implied. Do not return "low".

Return JSON only.`;

const SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          values: { type: "array", items: { type: "string" }, minItems: 1 },
          confidence: { type: "string", enum: ["high", "medium"] },
        },
        required: ["name", "values", "confidence"],
        additionalProperties: false,
      },
    },
    notes: { type: "string" },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

// --- Deterministic mapping helpers ----------------------------------------

// Normalize variations the AI / user might produce → canonical eBay-ish form.
function normalizeValue(aspect: string, raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  const a = aspect.toLowerCase();
  const lower = v.toLowerCase();

  if (a === "department") {
    if (/^wom[ae]n'?s?$/i.test(v) || lower === "ladies" || lower === "female") return "Women";
    if (/^men'?s?$/i.test(v) || lower === "male") return "Men";
    if (/^(kid'?s?|child|children|youth|boys|girls)$/i.test(v)) return "Kids";
    if (lower === "unisex" || lower === "unisex adult") return "Unisex Adult";
  }
  if (a === "condition") {
    if (/new\s*with\s*tags|nwt/i.test(v)) return "New with tags";
    if (/^new$/i.test(v)) return "New with tags";
    if (/new\s*without\s*tags|nwot/i.test(v)) return "New without tags";
    if (/pre[-\s]?owned|used/i.test(v)) return "Pre-owned";
  }
  if (a === "type") {
    if (/^tank( top)?$/i.test(v)) return "Tank Top";
  }
  if (a === "size type") {
    if (/^reg(ular)?$/i.test(v)) return "Regular";
    if (/^plus$/i.test(v)) return "Plus";
    if (/^petite$/i.test(v)) return "Petite";
  }
  return v;
}

// Snap value to allowed list (case-insensitive); also tries normalized form and
// a "contains" fallback (e.g. "Neon Pink" → "Pink").
function snapToAllowed(value: string, allowed: string[]): string | null {
  if (!allowed.length) return value;
  const lower = value.toLowerCase();
  const exact = allowed.find((x) => x.toLowerCase() === lower);
  if (exact) return exact;
  // contains: pick the allowed value that appears inside the proposed value
  const contained = allowed.find((x) => lower.includes(x.toLowerCase()));
  if (contained) return contained;
  // reverse: proposed inside allowed
  const reverse = allowed.find((x) => x.toLowerCase().includes(lower));
  return reverse ?? null;
}

interface ProductCtx {
  brand: string | null;
  condition: string | null;
  title: string;
  description: string;
  ai_specs: Map<string, string>; // lower-name → value
}

function buildProductFill(
  aspects: Array<{ name: string; values: string[]; cardinality: string }>,
  p: ProductCtx,
): EbayAspectAutofillSuggestion[] {
  const out: EbayAspectAutofillSuggestion[] = [];

  for (const a of aspects) {
    let candidate: string | null = null;
    const key = a.name.toLowerCase();

    // 1) direct match from AI item_specifics
    const direct = p.ai_specs.get(key);
    if (direct) candidate = direct;

    // 2) product-level mappings
    if (!candidate) {
      if (key === "brand" && p.brand) candidate = p.brand;
      else if (key === "condition" && p.condition) candidate = p.condition;
    }

    if (!candidate) continue;

    const normalized = normalizeValue(a.name, candidate);
    const snapped = snapToAllowed(normalized, a.values);
    if (!snapped) continue;

    out.push({
      name: a.name,
      values: [snapped],
      confidence: "high",
      source: "product",
    });
  }

  return out;
}

// --------------------------------------------------------------------------

export const autofillEbayAspects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<EbayAspectAutofillResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");

    const { data: product, error } = await context.supabase
      .from("products")
      .select(
        "id, title, description, condition, item_specifics, ebay_aspects, brand:brands(name), category:categories(name)",
      )
      .eq("id", data.productId)
      .maybeSingle();
    if (error) throw error;
    if (!product) throw new Error("Product not found");

    const aiSpecsArr = Array.isArray(product.item_specifics)
      ? (product.item_specifics as Array<{ name?: string; value?: string }>)
      : [];
    const aiSpecs = new Map<string, string>();
    for (const s of aiSpecsArr) {
      if (s?.name && s?.value) aiSpecs.set(String(s.name).toLowerCase(), String(s.value));
    }

    const productCtx: ProductCtx = {
      brand: (product as any).brand?.name ?? null,
      condition: product.condition ?? null,
      title: product.title ?? "",
      description: (product.description ?? "").slice(0, 1500),
      ai_specs: aiSpecs,
    };

    // 1) Deterministic pre-fill from product + AI item_specifics
    const productFill = buildProductFill(data.aspects, productCtx);
    const filledNames = new Set(productFill.map((s) => s.name));

    // 2) Only ask the AI about aspects we couldn't fill deterministically
    const remaining = data.aspects.filter((a) => !filledNames.has(a.name));

    let aiSuggestions: EbayAspectAutofillSuggestion[] = [];
    let aiNotes: string | undefined;

    if (remaining.length > 0) {
      const aspectList = remaining.map((a) => ({
        name: a.name,
        required: a.required,
        mode: a.mode,
        cardinality: a.cardinality,
        data_type: a.dataType,
        allowed_values: a.values.slice(0, 50),
      }));

      const userPayload = {
        ebay_category: { id: data.categoryId, name: data.categoryName ?? null },
        product: {
          title: productCtx.title,
          description: productCtx.description,
          brand: productCtx.brand,
          condition: productCtx.condition,
          internal_category: (product as any).category?.name ?? null,
          existing_item_specifics: aiSpecsArr,
          existing_ebay_aspects: product.ebay_aspects ?? {},
          already_filled: Array.from(filledNames),
        },
        aspects: aspectList,
      };

      const body = {
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Fill eBay Item Specifics for this product. Only return aspects you are confident about.\n\n${JSON.stringify(userPayload)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "ebay_aspects_autofill", strict: true, schema: SCHEMA },
        },
      };

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 45_000);
      let res: Response;
      try {
        res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(t);
      }

      if (!res.ok) {
        const txt = await res.text();
        if (res.status === 429) throw new Error("AI rate limit reached. Try again shortly.");
        if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
        throw new Error(`AI gateway error ${res.status}: ${txt.slice(0, 300)}`);
      }
      const raw = await res.json();
      let content: string = raw?.choices?.[0]?.message?.content ?? "";
      const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenced) content = fenced[1];
      content = content.trim();
      let parsed: { suggestions?: EbayAspectAutofillSuggestion[]; notes?: string };
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error("AI returned invalid JSON.");
      }
      aiNotes = parsed.notes;

      const byName = new Map(remaining.map((a) => [a.name, a]));
      for (const s of parsed.suggestions ?? []) {
        const aspect = byName.get(s.name);
        if (!aspect) continue;
        const values = (s.values ?? [])
          .map((v) => normalizeValue(s.name, String(v)))
          .filter(Boolean);
        if (!values.length) continue;
        if (aspect.values.length > 0) {
          const snapped = values
            .map((v) => snapToAllowed(v, aspect.values))
            .filter((v): v is string => !!v);
          if (!snapped.length) continue;
          aiSuggestions.push({ name: s.name, values: snapped, confidence: s.confidence, source: "ai" });
        } else {
          aiSuggestions.push({ name: s.name, values, confidence: s.confidence, source: "ai" });
        }
      }
    }

    const merged = [...productFill, ...aiSuggestions];

    console.log("[eBay aspects autofill]", {
      product_id: data.productId,
      category_id: data.categoryId,
      requested: data.aspects.length,
      from_product: productFill.length,
      asked_ai: remaining.length,
      from_ai: aiSuggestions.length,
    });

    return {
      suggestions: merged,
      notes: aiNotes,
      fromProduct: productFill.length,
      fromAi: aiSuggestions.length,
    };
  });

