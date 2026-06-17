import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  analyzeProductWithAI,
  researchProductWithAI,
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
            variant="ghost"
            onClick={async () => {
              if (!suggestion && !researchResult) {
                toast.error("No AI output yet — run Analyze or Research first.");
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
                console.log("[AI panel] raw JSON copied", payload);
                toast.success("Raw AI JSON copied to clipboard");
              } catch (e) {
                console.error("[AI panel] copy failed", e);
                toast.error("Failed to copy — check console for JSON");
              }
            }}
            disabled={!suggestion && !researchResult}
            title="Copy the latest AI suggestion + research JSON for prompt debugging"
          >
            <Copy className="h-4 w-4 mr-1" />
            Copy raw AI JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={startResearch}
            disabled={runResearch.isPending || !hasPhotos}
            aria-busy={runResearch.isPending}
          >
            <Search className="h-4 w-4 mr-1" />
            {runResearch.isPending ? "Researching…" : "Improve with Research"}
          </Button>
          <Button
            size="sm"
            onClick={startAnalyze}
            disabled={run.isPending || !hasPhotos}
            aria-busy={run.isPending}
          >
            <Wand2 className="h-4 w-4 mr-1" />
            {run.isPending ? "Analyzing…" : suggestion ? "Re-analyze" : "Analyze with AI"}
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
        {researchResult && <ResearchBlock result={researchResult} />}
        {!hasPhotos ? (
          <p className="text-sm text-muted-foreground">
            Add at least one photo to enable AI analysis.
          </p>
        ) : !suggestion ? (
          <p className="text-sm text-muted-foreground">
            Click <b>Analyze with AI</b> for a listing draft, or <b>Improve with Research</b>
            {" "}to surface identification clues and search queries before pricing.
            Nothing is saved to the product until you click <b>Apply to product</b>.
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
    <ResearchAgentPanel
      productId={product.id}
      suggestion={suggestion}
      research={researchResult}
    />
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
          description: s.description,
          brand_id,
          category_id,
          condition: s.condition,
          price_cents: s.suggested_price_cents,
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
          <Button size="sm" variant="ghost" onClick={() => copy(s.description, "description")}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Textarea
          value={s.description}
          rows={6}
          onChange={(e) => update("description", e.target.value)}
        />
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

      <div className="space-y-2">
        <Label>Verification needed (operator must confirm in person)</Label>
        <Input
          value={(s.verification_needed ?? []).join(", ")}
          placeholder="size, brand, authenticity, measurements…"
          onChange={(e) =>
            update(
              "verification_needed",
              e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
            )
          }
        />
        <div className="flex flex-wrap gap-1">
          {(s.verification_needed ?? []).map((t, i) => (
            <Badge key={i} variant="outline" className="text-[10px]">
              ⚠ {t}
            </Badge>
          ))}
        </div>
      </div>

      {s.confidence_notes && (
        <div className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">AI notes: </span>
          {s.confidence_notes}
        </div>
      )}

      {(s.possible_brand || s.possible_model || s.visual_clues?.length || s.search_keywords?.length || s.recommended_research_queries?.length || s.price_confidence === "manual_required" || s.potentially_valuable) && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm space-y-2">
          <div className="font-medium text-foreground flex items-center gap-1">
            <Search className="h-3.5 w-3.5" /> Research clues (hypotheses — verify manually)
          </div>
          {(s.possible_brand || s.possible_model) && (
            <div>
              <span className="text-muted-foreground">Possibly: </span>
              {[s.possible_brand, s.possible_model].filter(Boolean).join(" — ")}
            </div>
          )}
          {s.visual_clues?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {s.visual_clues.map((c, i) => (
                <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
              ))}
            </div>
          )}
          {s.search_keywords?.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Search keywords</div>
              <div className="flex flex-wrap gap-1">
                {s.search_keywords.map((k, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">{k}</Badge>
                ))}
              </div>
            </div>
          )}
          {s.recommended_research_queries?.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Recommended research queries</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {s.recommended_research_queries.map((q, i) => (
                  <li key={i} className="text-sm">{q}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="text-[10px]">
              Price confidence: {s.price_confidence}
            </Badge>
            {s.potentially_valuable && (
              <Badge variant="destructive" className="text-[10px] flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Potentially valuable — research before pricing
              </Badge>
            )}
            {s.price_confidence === "manual_required" && (
              <Badge variant="destructive" className="text-[10px]">
                Manual pricing recommended
              </Badge>
            )}
          </div>
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
