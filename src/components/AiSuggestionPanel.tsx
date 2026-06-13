import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { analyzeProductWithAI, type AiSuggestion } from "@/lib/ai-suggestions.functions";
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
import { Copy, Sparkles, Wand2 } from "lucide-react";

export function AiSuggestionPanel({
  product,
  hasPhotos,
  onApplied,
}: {
  product: any;
  hasPhotos: boolean;
  onApplied: () => void;
}) {
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeProductWithAI);
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);

  const run = useMutation({
    mutationFn: async () => analyze({ data: { productId: product.id } }),
    onSuccess: (s) => {
      setSuggestion(s);
      toast.success("Suggestion ready — review and apply.");
    },
    onError: (e: any) => toast.error(e.message ?? "AI failed"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> AI listing suggestion
        </CardTitle>
        <Button
          size="sm"
          onClick={() => {
            if (!hasPhotos) {
              toast.error("Add at least one photo before analyzing.");
              return;
            }
            run.mutate();
          }}
          disabled={run.isPending || !hasPhotos}
        >
          <Wand2 className="h-4 w-4 mr-1" />
          {run.isPending ? "Analyzing…" : suggestion ? "Re-analyze" : "Analyze with AI"}
        </Button>
      </CardHeader>
      <CardContent>
        {!hasPhotos ? (
          <p className="text-sm text-muted-foreground">
            Add at least one photo to enable AI analysis.
          </p>
        ) : !suggestion ? (
          <p className="text-sm text-muted-foreground">
            Click <b>Analyze with AI</b> to generate an editable listing suggestion.
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

      {s.confidence_notes && (
        <div className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">AI notes: </span>
          {s.confidence_notes}
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
