import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  storagePaths: z.array(z.string().min(1)).min(1).max(60),
});

export type PhotoGroupResult = {
  groups: number[][];
  reasoning: string;
};

const SYSTEM_PROMPT = `You are helping a resale operator group product photos.
You will receive multiple photos that show DIFFERENT physical products mixed together.
Your job: group photos that show the SAME physical product.

Rules:
- Each photo index belongs to EXACTLY ONE group.
- Use visual evidence only: same item from different angles, same background/surface taken in sequence, identical object features (color, shape, branding, wear marks).
- A single photo can be its own group if no others match it.
- Do not invent groupings to "balance" sizes.
- Prefer over-splitting (more, smaller groups) over wrong merges. A human will review.

Output strictly the JSON schema. Photo indexes are 0-based and refer to the order images were provided.`;

const SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "array",
        items: { type: "integer", minimum: 0 },
        minItems: 1,
      },
    },
    reasoning: { type: "string" },
  },
  required: ["groups", "reasoning"],
  additionalProperties: false,
};

const AI_TIMEOUT_MS = 60_000;

export const groupPhotosBySimilarity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<PhotoGroupResult> => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");

    const { data: signed, error } = await supabase.storage
      .from("product-photos")
      .createSignedUrls(data.storagePaths, 60 * 30);
    if (error) throw new Error(`Could not sign photo URLs: ${error.message}`);

    const urls = (signed ?? [])
      .map((s: any) => s.signedUrl as string | null)
      .filter((u: string | null): u is string => !!u);

    if (urls.length !== data.storagePaths.length) {
      throw new Error("Some photos could not be signed for AI access.");
    }

    const userText = `There are ${urls.length} photos, indexed 0..${
      urls.length - 1
    } in the order shown. Group them by physical product.`;

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            ...urls.map((url, i) => ({
              type: "text" as const,
              text: `Photo index ${i}:`,
            })).flatMap((label, i) => [
              label,
              { type: "image_url" as const, image_url: { url: urls[i] } },
            ]),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "photo_groups", strict: true, schema: SCHEMA },
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
        throw new Error("AI grouping timed out. Try with fewer photos.");
      }
      throw new Error(`AI gateway unreachable: ${e?.message ?? e}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 429) throw new Error("AI rate limit reached. Try shortly.");
      if (res.status === 402) throw new Error("AI credits exhausted.");
      throw new Error(`AI gateway error ${res.status}: ${txt.slice(0, 300)}`);
    }

    const raw = await res.json();
    let content: string = raw?.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("AI returned an empty response.");
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) content = fenced[1];
    let parsed: PhotoGroupResult;
    try {
      parsed = JSON.parse(content.trim()) as PhotoGroupResult;
    } catch {
      throw new Error("AI returned invalid JSON for grouping.");
    }

    // Validate + repair: every index 0..N-1 must appear exactly once.
    const n = urls.length;
    const seen = new Set<number>();
    const repaired: number[][] = [];
    for (const g of parsed.groups ?? []) {
      const clean = (g ?? []).filter(
        (i) => Number.isInteger(i) && i >= 0 && i < n && !seen.has(i),
      );
      clean.forEach((i) => seen.add(i));
      if (clean.length) repaired.push(clean);
    }
    // Any photo the AI dropped becomes its own group.
    for (let i = 0; i < n; i++) {
      if (!seen.has(i)) repaired.push([i]);
    }

    return {
      groups: repaired,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  });
