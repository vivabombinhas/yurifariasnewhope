import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ productId: z.string().uuid() });
const FinalizeInput = z.object({
  analysisId: z.string().uuid(),
  answers: z.record(z.string(), z.string().min(1)),
});

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
- Questions must ask for a FACT about the physical item. Never ask the operator to take/add a photo, research online, scan a code, or perform another workflow action. If a fact is unavailable, include an "Unknown/Not visible" option.
- Mark a question required only when its answer changes a publishable factual claim, condition tier, lot composition, safety, or price. Optional questions must not block saving.
- Describe every visible flaw and its location. No marketing fluff.
- All listing copy must be in natural English.
- Stock code is added elsewhere; do not invent one.
- Price is an ESTIMATE, not live market research. Use research_required for jewelry, watches, premium brands, rare collectibles, or unclear models. Never pretend you checked sold listings.
- item_specifics may contain confirmed values only. Never use "presumed", "likely", "appears", "possibly", "style", "unknown", or a guessed mechanism/material/model as an attribute value.
- Use a specific product category, not a broad or incorrect neighboring category. Funko Pop vinyl figures are Vinyl Figures/Action Figures, never Bobbleheads unless the packaging explicitly says bobblehead.
- Use NWT/New With Tags only when a physical retail/manufacturer tag is visibly attached. A sticker on packaging, hologram, or loose price sticker alone is not sufficient.

PLATFORM RULES:
- eBay: title <=80 characters; keyword-first. Description 500-900 characters when enough facts are visible. Structure the copy as factual item identification, an explicit Condition paragraph, and a final NOTE: "Please visit our store for additional similar items." shipping_text must mention FREE SHIPPING, an honest estimated packed weight and package dimensions when reasonably inferable (clearly label both Estimated), the packaging method, and ships from Cartersville, Georgia in 2-5 business days. eBay uses FREE SHIPPING, so buyer_shipping_cents=0 and estimated total equals listing price.
- Poshmark: concise, brand/style/size focused; buyer pays shipping. Do not say free shipping.
- Depop: concise and natural; emphasize relevant era/style/aesthetic only when supported. Avoid keyword spam and excessive hashtags.
- Each platform gets its own title and description; do not mechanically copy eBay.
- SALE FAST means a defensible quick-sale estimate. Provide an offer floor only when safe.
- Poshmark and Depop shipping_text must say buyer-paid shipping and must not copy the eBay free-shipping statement.

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

const UNCERTAIN_ATTRIBUTE =
  /\b(presum(?:ed|ably)|likely|appears?|possibly|maybe|unknown|guess(?:ed)?|style)\b/i;
const NOTE_LINE = "NOTE: Please visit our store for additional similar items.";

function normalizeResult(
  parsed: Omit<AiListingV2, "analysisId" | "status">,
  answers: Record<string, string> = {},
): Omit<AiListingV2, "analysisId" | "status"> {
  const identification = {
    ...parsed.identification,
    item_specifics: (parsed.identification.item_specifics ?? [])
      .map((item) => ({ name: item.name.trim(), value: item.value.trim() }))
      .filter((item) => item.name && item.value && !UNCERTAIN_ATTRIBUTE.test(item.value)),
  };
  const hasNwtClaim = (parsed.marketplace_drafts ?? []).some((draft) =>
    /\bNWT\b|\bnew with tags?\b/i.test(
      `${draft.title} ${draft.condition_text} ${draft.description}`,
    ),
  );
  let questions = (parsed.verification_questions ?? [])
    .filter(
      (question) =>
        question.prompt.trim() &&
        !/\b(take|add|upload|research|search|scan)\b.*\b(photo|picture|online|code|barcode)\b/i.test(
          question.prompt,
        ),
    )
    .map((question) => ({
      ...question,
      reason: question.reason.replace(/authenticity/gi, "product identification"),
      required:
        question.required ||
        /\b(seal(?:ed)?|opened|working|works|tested|complete|missing|damage|cracks?|hang tag|attached tag)\b/i.test(
          question.prompt,
        ),
    }));
  const hasTagQuestion = questions.some((question) =>
    /\b(hang tag|attached tag|tag physically attached)\b/i.test(question.prompt),
  );
  if (hasNwtClaim && !hasTagQuestion && !answers.attached_hang_tag) {
    questions.push({
      key: "attached_hang_tag",
      prompt: "Is a physical retail or manufacturer hang tag attached to the item?",
      reason: "NWT can only be used when a physical tag is visibly attached.",
      options: ["Attached hang tag", "Stickers only", "No tag", "Unknown"],
      required: true,
    });
  }

  function answerFor(question: VerificationQuestionV2) {
    return answers[question.key]?.trim();
  }
  const unresolvedSeal = questions.some(
    (question) => /\bseal(?:ed)?\b/i.test(question.prompt) && !answerFor(question),
  );
  const tagQuestion = questions.find((question) =>
    /\b(hang tag|attached tag|tag physically attached)\b/i.test(question.prompt),
  );
  const tagAnswer = (
    answers.attached_hang_tag ??
    (tagQuestion ? answers[tagQuestion.key] : "") ??
    ""
  ).trim();
  const attachedTagConfirmed = /^attached hang tag$/i.test(tagAnswer);

  function sanitizeCopy(value: string, validation: string[]) {
    let text = value;
    const banned: Array<[RegExp, string, string]> = [
      [/\bauthentic\b/gi, "", "removed_unverified_authenticity_claim"],
      [/\brare\b/gi, "", "removed_unverified_rarity_claim"],
      [/\binsane\b/gi, "", "removed_marketing_exaggeration"],
      [/\bdeadstock\b/gi, "new in package", "replaced_deadstock_claim"],
    ];
    for (const [pattern, replacement, flag] of banned) {
      if (text.match(pattern)) {
        text = text.replace(pattern, replacement);
        validation.push(flag);
      }
    }
    if (hasNwtClaim && !attachedTagConfirmed) {
      const replacement = /stickers only/i.test(tagAnswer)
        ? "New with stickers"
        : /no tag/i.test(tagAnswer)
          ? "New without tags"
          : "New — tag status unconfirmed";
      if (/\bNWT\b|\bnew with tags?\b/i.test(text)) {
        text = text.replace(/\bNWT\b|\bnew with tags?\b/gi, replacement);
        validation.push("nwt_requires_attached_hang_tag");
      }
    }
    if (unresolvedSeal && /\b(factory\s+)?sealed\b/i.test(text)) {
      text = text.replace(
        /\b(factory\s+)?sealed\b/gi,
        "in original packaging (seal status unconfirmed)",
      );
      validation.push("seal_claim_waiting_for_confirmation");
    }
    return text.replace(/[ \t]{2,}/g, " ").trim();
  }

  const drafts = (parsed.marketplace_drafts ?? []).map((source) => {
    const validation = [...(source.validation_flags ?? [])];
    let title = sanitizeCopy((source.title ?? "").trim(), validation);
    const titleLimit = source.marketplace === "ebay" ? 80 : 100;
    if (title.length > titleLimit) {
      title = title
        .slice(0, titleLimit)
        .replace(/\s+\S*$/, "")
        .trim();
      validation.push(`title_trimmed_to_${titleLimit}_characters`);
    }
    let conditionText = sanitizeCopy((source.condition_text ?? "").trim(), validation);
    let description = sanitizeCopy((source.description ?? "").trim(), validation);
    const paragraphs = description
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(
        (paragraph) =>
          paragraph &&
          !/^shipping\s*(?:&\s*handling)?\s*:/i.test(paragraph) &&
          !/^NOTE:/i.test(paragraph),
      );
    const descriptionBody = paragraphs.join("\n\n");
    const maxBodyLength = 900 - NOTE_LINE.length - 2;
    description = `${descriptionBody.slice(0, maxBodyLength).trim()}\n\n${NOTE_LINE}`.trim();
    if (descriptionBody.length > maxBodyLength) {
      validation.push("description_trimmed_to_900_characters");
    }
    if (UNCERTAIN_ATTRIBUTE.test(`${title} ${conditionText}`)) {
      validation.push("uncertain_claim_in_publishable_copy");
    }
    return {
      ...source,
      title,
      description,
      condition_text: conditionText,
      shipping_text: sanitizeCopy((source.shipping_text ?? "").trim(), validation),
      keywords: source.keywords ?? [],
      validation_flags: [...new Set(validation)],
    };
  });
  return {
    ...parsed,
    identification,
    verification_questions: questions,
    quality_flags: parsed.quality_flags ?? [],
    marketplace_drafts: drafts,
  };
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

async function callGateway(apiKey: string, imageUrls: string[], userText: string) {
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
                text: userText,
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
    const {
      model,
      raw,
      parsed: rawParsed,
    } = await callGateway(
      apiKey,
      imageUrls,
      "Analyze this product and create the three marketplace drafts.",
    );
    const parsed = normalizeResult(rawParsed);
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

export const finalizeProductV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FinalizeInput.parse(input))
  .handler(async ({ data, context }): Promise<AiListingV2> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");
    const { supabase } = context;
    const db = supabase as any;
    const { data: analysis, error: analysisError } = await db
      .from("ai_product_analyses")
      .select("id, product_id, identification, verification_questions, quality_flags")
      .eq("id", data.analysisId)
      .single();
    if (analysisError || !analysis)
      throw new Error(`Load AI v2 analysis: ${analysisError?.message ?? "not found"}`);

    const { data: currentDrafts, error: draftsError } = await db
      .from("ai_marketplace_drafts")
      .select(
        "marketplace, title, condition_text, description, shipping_text, listing_price_cents, minimum_offer_cents, buyer_shipping_cents, estimated_buyer_total_cents, price_confidence, pricing_basis, keywords, validation_flags",
      )
      .eq("analysis_id", data.analysisId);
    if (draftsError) throw new Error(`Load marketplace drafts: ${draftsError.message}`);

    const imageUrls = await loadPhotoUrls(supabase, analysis.product_id);
    const answerLines = Object.entries(data.answers)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");
    const {
      model,
      raw,
      parsed: rawParsed,
    } = await callGateway(
      apiKey,
      imageUrls,
      `Revise the existing analysis and all three drafts using the operator's confirmed answers.

OPERATOR ANSWERS (authoritative):
${answerLines || "(none)"}

PREVIOUS IDENTIFICATION:
${JSON.stringify(analysis.identification)}

PREVIOUS QUESTIONS:
${JSON.stringify(analysis.verification_questions)}

PREVIOUS MARKETPLACE DRAFTS:
${JSON.stringify(currentDrafts ?? [])}

Apply each answer consistently to identification, condition, titles, descriptions, shipping and pricing. Do not preserve a contradicted assumption. Return only genuinely unresolved verification questions.`,
    );
    const parsed = normalizeResult(rawParsed, data.answers);
    const questions = Array.isArray(parsed.verification_questions)
      ? parsed.verification_questions
      : [];
    const status = questions.some((q) => q.required) ? "needs_review" : "ready";
    const drafts = (parsed.marketplace_drafts ?? []).filter((draft) =>
      ["ebay", "poshmark", "depop"].includes(draft.marketplace),
    );

    const { error: updateError } = await db
      .from("ai_product_analyses")
      .update({
        status,
        model,
        identification: parsed.identification,
        verification_questions: questions,
        verification_answers: data.answers,
        quality_flags: parsed.quality_flags ?? [],
        raw_response: raw,
      })
      .eq("id", data.analysisId);
    if (updateError) throw new Error(`Update AI v2 analysis: ${updateError.message}`);

    const { error: upsertError } = await db.from("ai_marketplace_drafts").upsert(
      drafts.map((draft) => ({
        ...draft,
        analysis_id: data.analysisId,
        product_id: analysis.product_id,
      })),
      { onConflict: "analysis_id,marketplace" },
    );
    if (upsertError) throw new Error(`Update marketplace drafts: ${upsertError.message}`);

    return {
      ...parsed,
      analysisId: data.analysisId,
      status,
      verification_questions: questions,
      marketplace_drafts: drafts,
    };
  });
