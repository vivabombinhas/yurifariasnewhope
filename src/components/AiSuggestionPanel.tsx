import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  analyzeProductWithAI,
  researchProductWithAI,
  improveListingWithAI,
  type AiSuggestion,
  type AiResearchResult,
} from "@/lib/ai-suggestions.functions";
import { withTimeout } from "@/lib/async-timeout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRODUCT_CONDITIONS, formatPrice, formatStatus } from "@/lib/marketplaces";
import { toast } from "sonner";
import { AlertTriangle, Copy, Search, Sparkles, Wand2 } from "lucide-react";
import { ResearchAgentPanel } from "@/components/ResearchAgentPanel";

export function AiSuggestionPanel({
  product,
  hasPhotos,
  unsupportedCount = 0,
  onApplied,
}: {
  product: any;
  hasPhotos: boolean;
  unsupportedCount?: number;
  onApplied: () => void;
}) {
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeProductWithAI);
  const research = useServerFn(researchProductWithAI);
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [researchResult, setResearchResult] = useState<AiResearchResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load the latest stored AI suggestion (e.g. one generated in batch) so it
  // pre-fills the editor instead of forcing the user to click "Generate listing" again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("ai_suggestions")
        .select("suggestion, accepted")
        .eq("product_id", product.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("[AI panel] load latest suggestion failed", error);
        return;
      }
      if (data?.suggestion && !data.accepted) {
        setSuggestion(data.suggestion as unknown as AiSuggestion);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  const run = useMutation({
    mutationFn: async () => {
      console.log("[AI panel] analyzing product", product.id);
      return withTimeout(
        analyze({ data: { productId: product.id } }),
        55_000,
        "AI analysis timed out. Please try again with fewer photos or smaller images.",
      );
    },
    onSuccess: (s) => {
      console.log("[AI panel] success", s);
      setSuggestion(s);
      toast.success("Suggestion ready — review and apply.");
    },
    onError: (e: any) => {
      console.error("[AI panel] failed", e);
      toast.error(e?.message ?? "AI failed");
    },
  });

  const runResearch = useMutation({
    mutationFn: async () => {
      console.log("[AI panel] research product", product.id);
      return withTimeout(
        research({ data: { productId: product.id } }),
        55_000,
        "AI research timed out. Please try again.",
      );
    },
    onSuccess: (r) => {
      console.log("[AI panel] research success", r);
      setResearchResult(r);
      toast.success("Research clues ready — verify manually before pricing.");
    },
    onError: (e: any) => {
      console.error("[AI panel] research failed", e);
      toast.error(e?.message ?? "Research failed");
    },
  });

  const startAnalyze = () => {
    if (run.isPending) {
      console.log("[AI panel] click ignored — already analyzing");
      return;
    }
    if (!hasPhotos) {
      toast.error("Add at least one photo before analyzing.");
      return;
    }
    if (unsupportedCount > 0) {
      toast.error("This image format is not supported for AI analysis. Please re-upload the photo as JPEG, PNG, WebP, or GIF.");
      return;
    }
    run.mutate();
  };

  const startResearch = () => {
    if (runResearch.isPending) return;
    if (!hasPhotos) {
      toast.error("Add at least one photo before researching.");
      return;
    }
    if (unsupportedCount > 0) {
      toast.error("This image format is not supported for AI analysis. Please re-upload the photo.");
      return;
    }
    runResearch.mutate();
  };

  const errorMsg = run.isError ? (run.error as any)?.message ?? "AI failed" : null;

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Quick listing
        </CardTitle>

        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={startAnalyze}
            disabled={run.isPending || !hasPhotos}
            aria-busy={run.isPending}
          >
            <Wand2 className="h-4 w-4 mr-1" />
            {run.isPending ? "Generating…" : suggestion ? "Regenerate listing" : "Generate listing"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {errorMsg && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="font-medium mb-1">AI analysis failed</div>
            <div className="break-words">{errorMsg}</div>
          </div>
        )}
        {unsupportedCount > 0 && (
          <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            {unsupportedCount === 1
              ? "1 photo is in an unsupported format (e.g. AVIF/HEIC) and cannot be analyzed by AI. Please re-upload it as JPEG, PNG, WebP, or GIF."
              : `${unsupportedCount} photos are in an unsupported format (e.g. AVIF/HEIC) and cannot be analyzed by AI. Please re-upload them as JPEG, PNG, WebP, or GIF.`}
          </div>
        )}
        {!hasPhotos ? (
          <p className="text-sm text-muted-foreground">
            Add at least one photo to enable AI analysis.
          </p>
        ) : !suggestion ? (
          <p className="text-sm text-muted-foreground">
            Click <b>Generate listing</b> to create a ready-to-publish marketplace draft.
            Nothing is saved until you click <b>Apply to product</b>.
          </p>
        ) : (
          <SuggestionEditor
            product={product}
            initial={suggestion}
            onApplied={() => {
              qc.invalidateQueries({ queryKey: ["product", product.id] });
              qc.invalidateQueries({ queryKey: ["products"] });
              onApplied();
            }}
          />
        )}
      </CardContent>
    </Card>

    <div className="flex justify-end">
      <Button
        size="sm"
        variant="ghost"
        className="text-xs text-muted-foreground"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide advanced research" : "Advanced research"}
      </Button>
    </div>

    {showAdvanced && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" /> Advanced research
          </CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!suggestion && !researchResult) {
                  toast.error("No AI output yet — run Generate or Research first.");
                  return;
                }
                const payload = JSON.stringify(
                  {
                    product_id: product.id,
                    suggestion,
                    research: researchResult,
                    copied_at: new Date().toISOString(),
                  },
                  null,
                  2,
                );
                try {
                  await navigator.clipboard.writeText(payload);
                  toast.success("Raw AI JSON copied to clipboard");
                } catch {
                  toast.error("Failed to copy — check console for JSON");
                }
              }}
              disabled={!suggestion && !researchResult}
            >
              <Copy className="h-4 w-4 mr-1" />
              Copy raw JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={startResearch}
              disabled={runResearch.isPending || !hasPhotos}
              aria-busy={runResearch.isPending}
            >
              <Search className="h-4 w-4 mr-1" />
              {runResearch.isPending ? "Researching…" : "Research this item"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {researchResult && <ResearchBlock result={researchResult} />}
          <ResearchAgentPanel
            productId={product.id}
            suggestion={suggestion}
            research={researchResult}
          />
        </CardContent>
      </Card>
    )}
    </div>
  );
}

function SuggestionEditor({
  product,
  initial,
  onApplied,
}: {
  product: any;
  initial: AiSuggestion;
  onApplied: () => void;
}) {
  const [s, setS] = useState<AiSuggestion>(initial);
  const [saving, setSaving] = useState(false);
  const [improving, setImproving] = useState(false);
  const [variations, setVariations] = useState<
    { label: string; title: string; description: string }[]
  >([]);
  const improveFn = useServerFn(improveListingWithAI);

  async function improve() {
    if (improving) return;
    setImproving(true);
    try {
      const out = (await withTimeout(
        improveFn({
          data: {
            productId: product.id,
            title: s.title,
            description: s.description,
            category: s.category,
            condition: s.condition,
          },
        }),
        55_000,
        "Improve Listing timed out. Please try again.",
      )) as { variations: { label: string; title: string; description: string }[] };
      const vs = out.variations ?? [];
      if (!vs.length) {
        toast.error("AI returned no variations. Please retry.");
        return;
      }
      setVariations(vs);
      toast.success(`Got ${vs.length} variations — pick one before applying.`);
    } catch (e: any) {
      console.error("[improve] failed", e);
      toast.error(e?.message ?? "Improve failed");
    } finally {
      setImproving(false);
    }
  }

  function applyVariation(v: { label?: string; title: string; description: string }) {
    console.log("[improve] applyVariation clicked", {
      label: v.label,
      newTitle: v.title,
      newDescription: v.description,
    });
    setS((cur) => {
      const next = { ...cur, title: v.title, description: v.description };
      console.log("[improve] state transition", {
        prevTitle: cur.title,
        prevDescription: cur.description,
        nextTitle: next.title,
        nextDescription: next.description,
      });
      return next;
    });
    setVariations([]);
    toast.success("Variation loaded into editor — review checklist, then Apply.");
  }

  function update<K extends keyof AiSuggestion>(k: K, v: AiSuggestion[K]) {
    setS((cur) => ({ ...cur, [k]: v }));
  }

  async function ensureRow(
    table: "brands" | "categories",
    name: string,
  ): Promise<string | null> {
    const t = name.trim();
    if (!t) return null;
    const { data: existing } = await supabase
      .from(table)
      .select("id")
      .ilike("name", t)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data, error } = await supabase
      .from(table)
      .insert({ name: t })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function apply() {
    // Warn before overwriting non-empty fields
    const conflicts: string[] = [];
    if (product.title && product.title.trim() && product.title !== s.title) conflicts.push("title");
    if (product.description && product.description.trim() && product.description !== s.description)
      conflicts.push("description");
    if (product.brand?.name && s.brand && product.brand.name.toLowerCase() !== s.brand.toLowerCase())
      conflicts.push("brand");
    if (
      product.category?.name &&
      s.category &&
      product.category.name.toLowerCase() !== s.category.toLowerCase()
    )
      conflicts.push("category");
    if (product.condition && product.condition !== s.condition) conflicts.push("condition");
    if (
      product.price_cents != null &&
      s.suggested_price_cents != null &&
      product.price_cents !== s.suggested_price_cents
    )
      conflicts.push("price");

    if (conflicts.length) {
      const ok = confirm(
        `This will overwrite existing values for: ${conflicts.join(", ")}.\n\nContinue?`,
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const brand_id = s.brand.trim() ? await ensureRow("brands", s.brand) : product.brand_id ?? null;
      const category_id = s.category.trim()
        ? await ensureRow("categories", s.category)
        : product.category_id ?? null;

      const { error } = await supabase
        .from("products")
        .update({
          title: s.title,
          description: (s.description ?? "").slice(0, 900),
          brand_id,
          category_id,
          condition: s.condition,
          price_cents: s.suggested_price_cents,
          item_specifics: (s.item_specifics ?? []) as any,
          condition_grade: s.condition_grade?.trim() || null,
          condition_notes: s.condition_notes?.trim() || null,
          shipping_notes: s.shipping_notes?.trim() || null,
        })
        .eq("id", product.id);
      if (error) throw error;

      // Find latest suggestion for this product and mark accepted
      const { data: latest } = await supabase
        .from("ai_suggestions")
        .select("id")
        .eq("product_id", product.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.id) {
        await supabase
          .from("ai_suggestions")
          .update({ accepted: true, suggestion: s as any })
          .eq("id", latest.id);
      }

      toast.success("Applied to product");
      onApplied();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to apply");
    } finally {
      setSaving(false);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  }

  const tagsString = s.tags.join(", ");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          onClick={improve}
          disabled={improving}
          aria-busy={improving}
          title="Rewrite title and description as a professional eBay-style listing"
        >
          <Sparkles className="h-4 w-4 mr-1" />
          {improving ? "Improving…" : "Improve Listing"}
        </Button>
      </div>

      {variations.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Pick a variation</div>
            <Button size="sm" variant="ghost" onClick={() => setVariations([])}>
              Dismiss
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {variations.map((v, i) => (
              <div
                key={i}
                className="rounded-md border bg-background p-3 space-y-2 flex flex-col"
              >
                <Badge variant="secondary" className="self-start text-[10px]">
                  {v.label}
                </Badge>
                <div className="text-sm font-medium leading-snug">{v.title}</div>
                <div className="text-xs text-muted-foreground whitespace-pre-line line-clamp-6">
                  {v.description}
                </div>
                <div className="mt-auto flex gap-1 pt-1">
                  <Button size="sm" className="flex-1" onClick={() => applyVariation(v)}>
                    Use this
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copy(`${v.title}\n\n${v.description}`, v.label)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <QualityChecklist title={s.title} description={s.description} />
        </div>
      )}

      {variations.length === 0 && (s.title || s.description) && (
        <QualityChecklist title={s.title} description={s.description} />
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Title</Label>
          <Button size="sm" variant="ghost" onClick={() => copy(s.title, "title")}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Input value={s.title} onChange={(e) => update("title", e.target.value)} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Description</Label>
          <div className="flex items-center gap-2">
            <span
              className={`text-[11px] ${
                s.description.length > 900 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {s.description.length} / 900
            </span>
            <Button size="sm" variant="ghost" onClick={() => copy(s.description, "description")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <Textarea
          value={s.description}
          rows={6}
          maxLength={900}
          onChange={(e) => update("description", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Item specifics</Label>
        <ItemSpecificsEditor
          value={s.item_specifics}
          onChange={(v) => update("item_specifics", v)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Condition grade</Label>
          <Input
            value={s.condition_grade}
            placeholder="e.g. Used – Acceptable"
            onChange={(e) => update("condition_grade", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Condition notes</Label>
          <Textarea
            value={s.condition_notes}
            rows={2}
            onChange={(e) => update("condition_notes", e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Shipping notes</Label>
          <Textarea
            value={s.shipping_notes}
            rows={2}
            onChange={(e) => update("shipping_notes", e.target.value)}
          />
        </div>
      </div>


      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Brand</Label>
          <Input value={s.brand} onChange={(e) => update("brand", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Input value={s.category} onChange={(e) => update("category", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Condition</Label>
          <Select value={s.condition} onValueChange={(v) => update("condition", v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRODUCT_CONDITIONS.map((c) => (
                <SelectItem key={c} value={c}>{formatStatus(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Suggested price (USD)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={
              s.suggested_price_cents != null ? (s.suggested_price_cents / 100).toFixed(2) : ""
            }
            onChange={(e) =>
              update(
                "suggested_price_cents",
                e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null,
              )
            }
          />
          {s.suggested_price_cents != null && (
            <p className="text-xs text-muted-foreground">
              {formatPrice(s.suggested_price_cents, product.currency)}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Tags</Label>
          <Button size="sm" variant="ghost" onClick={() => copy(tagsString, "tags")}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Input
          value={tagsString}
          onChange={(e) =>
            update(
              "tags",
              e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
            )
          }
        />
        <div className="flex flex-wrap gap-1">
          {s.tags.map((t, i) => (
            <Badge key={i} variant="secondary" className="text-[10px]">{t}</Badge>
          ))}
        </div>
      </div>

      {s.confidence_notes && (
        <div className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">AI notes: </span>
          {s.confidence_notes}
        </div>
      )}

      {s.price_confidence === "manual_required" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Potentially valuable item — research before pricing.</span>
        </div>
      )}


      <div className="flex gap-2">
        <Button onClick={apply} disabled={saving}>
          {saving ? "Applying…" : "Apply to product"}
        </Button>
      </div>
    </div>
  );
}

function ResearchBlock({ result }: { result: AiResearchResult }) {
  return (
    <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm space-y-2">
      <div className="font-medium text-foreground flex items-center gap-1">
        <Search className="h-4 w-4" /> Research clues (hypotheses — verify manually)
      </div>
      {(result.possible_brand || result.possible_model) && (
        <div>
          <span className="text-muted-foreground">Possibly: </span>
          {[result.possible_brand, result.possible_model].filter(Boolean).join(" — ")}
        </div>
      )}
      {result.potentially_valuable && (
        <div className="flex items-center gap-2 rounded bg-destructive/10 text-destructive p-2">
          <AlertTriangle className="h-4 w-4" />
          <div>
            <div className="font-medium">Potentially valuable item</div>
            {result.value_alert && <div className="text-xs">{result.value_alert}</div>}
          </div>
        </div>
      )}
      {result.visual_clues.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Visual clues</div>
          <div className="flex flex-wrap gap-1">
            {result.visual_clues.map((c, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
            ))}
          </div>
        </div>
      )}
      {result.search_keywords.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Search keywords</div>
          <div className="flex flex-wrap gap-1">
            {result.search_keywords.map((k, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">{k}</Badge>
            ))}
          </div>
        </div>
      )}
      {result.recommended_research_queries.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Recommended research queries</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {result.recommended_research_queries.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {result.verification_questions.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Verify in person</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {result.verification_questions.map((q, i) => (
              <li key={i}>⚠ {q}</li>
            ))}
          </ul>
        </div>
      )}
      {result.manual_research_recommendation && (
        <div className="text-xs text-muted-foreground border-t pt-2">
          <span className="font-medium text-foreground">Recommendation: </span>
          {result.manual_research_recommendation}
        </div>
      )}
    </div>
  );
}

function QualityChecklist({ title, description }: { title: string; description: string }) {
  const text = `${title}\n${description}`.toLowerCase();
  const checks = [
    {
      label: "Title is clear and under 80 characters",
      pass: title.trim().length > 0 && title.length <= 80,
    },
    {
      label: "Title front-loads searchable keywords (>= 3 words)",
      pass: title.trim().split(/\s+/).filter(Boolean).length >= 3,
    },
    {
      label: "Description has enough detail (>= 120 characters)",
      pass: description.trim().length >= 120,
    },
    {
      label: "No authenticity claims (authentic / 100% genuine / guaranteed real)",
      pass: !/\b(100% ?(genuine|authentic)|authentic(ity)? (guaranteed|verified)|guaranteed (genuine|authentic|real)|certified authentic)\b/i.test(
        text,
      ),
    },
    {
      label: "No unverified rarity claims (rare / limited edition / one of a kind)",
      pass: !/\b(rare|limited edition|one[- ]of[- ]a[- ]kind|extremely rare|hard to find)\b/i.test(
        text,
      ),
    },
    {
      label: "No hype / ALL-CAPS spam in title",
      pass: !/\b(WOW|L@@K|MUST SEE|HOT|RARE|AMAZING|INCREDIBLE)\b/.test(title) &&
        !/[A-Z]{6,}/.test(title),
    },
  ];
  return (
    <div className="rounded-md border bg-background p-3 text-sm space-y-2">
      <div className="font-medium">Quality checklist</div>
      <ul className="space-y-1">
        {checks.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className={c.pass ? "text-green-600" : "text-amber-600"}>
              {c.pass ? "✓" : "!"}
            </span>
            <span className={c.pass ? "text-muted-foreground" : "text-foreground"}>
              {c.label}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Quick local check — review manually before clicking <b>Apply to product</b>.
      </p>
    </div>
  );
}

function ItemSpecificsEditor({
  value,
  onChange,
}: {
  value: { name: string; value: string }[];
  onChange: (v: { name: string; value: string }[]) => void;
}) {
  const rows = value.length ? value : [{ name: "", value: "" }];
  function update(i: number, patch: Partial<{ name: string; value: string }>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next.filter((r) => r.name.trim() || r.value.trim()));
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...rows, { name: "", value: "" }]);
  }
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input
            className="flex-1"
            placeholder="Name (e.g. Color)"
            value={r.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <Input
            className="flex-[2]"
            placeholder="Value (e.g. White)"
            value={r.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label="Remove">
            <Copy className="h-3.5 w-3.5 rotate-45 opacity-0" />×
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={add}>
        + Add specific
      </Button>
    </div>
  );
}

