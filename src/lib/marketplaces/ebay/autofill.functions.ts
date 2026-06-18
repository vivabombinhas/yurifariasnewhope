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

    const productContext = {
      title: product.title ?? "",
      description: (product.description ?? "").slice(0, 1500),
      brand: (product as any).brand?.name ?? null,
      internal_category: (product as any).category?.name ?? null,
      condition: product.condition ?? null,
      tags: [] as string[],
      existing_item_specifics: product.item_specifics ?? [],
      existing_ebay_aspects: product.ebay_aspects ?? {},
    };

    const aspectList = data.aspects.map((a) => ({
      name: a.name,
      required: a.required,
      mode: a.mode,
      cardinality: a.cardinality,
      data_type: a.dataType,
      allowed_values: a.values.slice(0, 50),
    }));

    const userPayload = {
      ebay_category: { id: data.categoryId, name: data.categoryName ?? null },
      product: productContext,
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
    let parsed: EbayAspectAutofillResult;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI returned invalid JSON.");
    }

    // Hard filter: drop suggestions whose name is not in the requested aspect list,
    // and snap values to the allowed_values list when present.
    const byName = new Map(data.aspects.map((a) => [a.name, a]));
    const filtered: EbayAspectAutofillSuggestion[] = [];
    for (const s of parsed.suggestions ?? []) {
      const aspect = byName.get(s.name);
      if (!aspect) continue;
      const values = (s.values ?? [])
        .map((v) => String(v).trim())
        .filter(Boolean);
      if (!values.length) continue;
      if (aspect.values.length > 0) {
        const allowed = new Set(aspect.values.map((v) => v.toLowerCase()));
        const snapped = values.filter((v) => allowed.has(v.toLowerCase()));
        if (!snapped.length) continue;
        filtered.push({ name: s.name, values: snapped, confidence: s.confidence });
      } else {
        filtered.push({ name: s.name, values, confidence: s.confidence });
      }
    }

    console.log("[eBay aspects autofill]", {
      product_id: data.productId,
      category_id: data.categoryId,
      requested: data.aspects.length,
      returned: parsed.suggestions?.length ?? 0,
      kept: filtered.length,
    });

    return { suggestions: filtered, notes: parsed.notes };
  });
