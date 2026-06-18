import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ListChecks, Save, Sparkles } from "lucide-react";
import {
  fetchEbayAspectsForCategory,
  saveEbayAspects,
  type EbayAspectDTO,
} from "@/lib/marketplaces/ebay/taxonomy.functions";
import { autofillEbayAspects } from "@/lib/marketplaces/ebay/autofill.functions";

interface Props {
  product: {
    id: string;
    title?: string | null;
    ebay_category_id?: string | null;
    ebay_category_name?: string | null;
    ebay_aspects?: Record<string, string[]> | null | unknown;
  };
  onSaved?: () => void;
}

// Aspects that should always show up if not returned by API
const ALWAYS_SHOW = ["Brand", "US Shoe Size", "Color", "Style", "Department", "Type", "Condition"];

function modeBadge(mode: EbayAspectDTO["mode"]) {
  if (mode === "REQUIRED") return <Badge variant="destructive">Required</Badge>;
  if (mode === "RECOMMENDED") return <Badge variant="default">Recommended</Badge>;
  return <Badge variant="outline">Optional</Badge>;
}

export function EbayAspectsPanel({ product, onSaved }: Props) {
  const qc = useQueryClient();
  const fetchFn = useServerFn(fetchEbayAspectsForCategory);
  const saveFn = useServerFn(saveEbayAspects);
  const autofillFn = useServerFn(autofillEbayAspects);

  const categoryId = product.ebay_category_id ?? null;

  const aspectsQ = useQuery({
    enabled: !!categoryId,
    queryKey: ["ebay-aspects", categoryId],
    queryFn: () => fetchFn({ data: { categoryId: categoryId! } }),
  });

  const initial = useMemo<Record<string, string[]>>(() => {
    const v = product.ebay_aspects;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, val]) => [
          k,
          Array.isArray(val) ? (val as string[]) : [String(val ?? "")],
        ]),
      );
    }
    return {};
  }, [product.ebay_aspects]);

  const [values, setValues] = useState<Record<string, string[]>>(initial);
  useEffect(() => setValues(initial), [initial]);

  const aspects: EbayAspectDTO[] = useMemo(() => {
    const fromApi = aspectsQ.data?.aspects ?? [];
    const byName = new Map(fromApi.map((a) => [a.name, a]));
    for (const name of ALWAYS_SHOW) {
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          required: false,
          mode: "OPTIONAL",
          cardinality: "SINGLE",
          dataType: "STRING",
          selectionMode: "FREE_TEXT",
          values: [],
        });
      }
    }
    return Array.from(byName.values()).sort((a, b) => {
      const order = { REQUIRED: 0, RECOMMENDED: 1, OPTIONAL: 2 } as const;
      return order[a.mode] - order[b.mode] || a.name.localeCompare(b.name);
    });
  }, [aspectsQ.data]);

  const missingRequired = useMemo(
    () =>
      (aspectsQ.data?.aspects ?? [])
        .filter((a) => a.required)
        .filter((a) => !(values[a.name]?.some((v) => v.trim().length > 0)))
        .map((a) => a.name),
    [aspectsQ.data, values],
  );

  const saveMut = useMutation({
    mutationFn: async () => {
      if (missingRequired.length) {
        throw new Error(
          `Fill required item specifics: ${missingRequired.join(", ")}`,
        );
      }
      const cleaned: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(values)) {
        const filtered = v.map((x) => x.trim()).filter(Boolean);
        if (filtered.length) cleaned[k] = filtered;
      }
      return saveFn({ data: { productId: product.id, aspects: cleaned } });
    },
    onSuccess: () => {
      toast.success("eBay item specifics saved");
      qc.invalidateQueries({ queryKey: ["product", product.id] });
      onSaved?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save aspects"),
  });

  const autofillMut = useMutation({
    mutationFn: async () => {
      if (!categoryId) throw new Error("Pick a category first");
      const allAspects = aspectsQ.data?.aspects ?? [];
      if (!allAspects.length) throw new Error("Aspects not loaded yet");
      return autofillFn({
        data: {
          productId: product.id,
          categoryId,
          categoryName: product.ebay_category_name ?? undefined,
          aspects: allAspects.map((a) => ({
            name: a.name,
            required: a.required,
            mode: a.mode,
            cardinality: a.cardinality,
            dataType: a.dataType,
            values: a.values,
          })),
        },
      });
    },
    onSuccess: (res) => {
      const kept = res.suggestions ?? [];
      if (!kept.length) {
        toast.info("AI couldn't confidently fill any aspect — please fill manually.");
        return;
      }
      setValues((prev) => {
        const next = { ...prev };
        for (const s of kept) {
          // only fill if currently empty — never overwrite operator input
          const cur = next[s.name] ?? [];
          if (cur.some((v) => v.trim().length > 0)) continue;
          next[s.name] = s.values;
        }
        return next;
      });
      toast.success(`AI filled ${kept.length} aspect(s) — review before saving.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Autofill failed"),
  });


  if (!categoryId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4" /> eBay Item Specifics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select an eBay category first to load item specifics.
          </p>
        </CardContent>
      </Card>
    );
  }

  const requiredMissing = missingRequired.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="h-4 w-4" /> eBay Item Specifics
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Cat: {product.ebay_category_name ?? categoryId}</Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => autofillMut.mutate()}
            disabled={
              autofillMut.isPending || aspectsQ.isLoading || !aspectsQ.data?.aspects.length
            }
            title="Use AI to fill aspects from product title/description. Only fills empty fields."
          >
            <Sparkles className="h-4 w-4 mr-1" />
            {autofillMut.isPending ? "Filling…" : "Auto-fill with AI"}
          </Button>
          <Button
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || aspectsQ.isLoading || requiredMissing}
          >
            <Save className="h-4 w-4 mr-1" />
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {aspectsQ.isLoading && (
          <p className="text-sm text-muted-foreground">Loading aspects from eBay…</p>
        )}
        {aspectsQ.isError && (
          <p className="text-sm text-destructive">
            {(aspectsQ.error as any)?.message ?? "Failed to load aspects"}
          </p>
        )}
        {requiredMissing && (
          <p className="text-xs text-destructive">
            Missing required: {missingRequired.join(", ")}
          </p>
        )}


        <div className="grid gap-3 sm:grid-cols-2">
          {aspects.map((a) => {
            const current = values[a.name] ?? [];
            const single = a.cardinality === "SINGLE";
            const isMissing = a.required && !current.some((v) => v.trim().length > 0);
            const setSingle = (v: string) =>
              setValues((prev) => ({ ...prev, [a.name]: v ? [v] : [] }));
            const setMulti = (v: string) =>
              setValues((prev) => ({
                ...prev,
                [a.name]: v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }));

            const hasOptions = a.values.length > 0;
            const useDropdown = single && hasOptions && a.selectionMode === "SELECTION_ONLY";

            return (
              <div key={a.name} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">{a.name}</Label>
                  {modeBadge(a.mode)}
                  {!single && <Badge variant="outline">Multi</Badge>}
                </div>
                {useDropdown ? (
                  <Select
                    value={current[0] ?? ""}
                    onValueChange={(v) => setSingle(v)}
                  >
                    <SelectTrigger
                      aria-invalid={isMissing}
                      className={isMissing ? "border-destructive" : undefined}
                    >
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {a.values.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : single ? (
                  <Input
                    list={hasOptions ? `aspect-${a.name}` : undefined}
                    value={current[0] ?? ""}
                    onChange={(e) => setSingle(e.target.value)}
                    placeholder={hasOptions ? a.values[0] : ""}
                    aria-invalid={isMissing}
                    className={isMissing ? "border-destructive" : undefined}
                  />
                ) : (
                  <Input
                    value={current.join(", ")}
                    onChange={(e) => setMulti(e.target.value)}
                    placeholder="Comma-separated"
                    aria-invalid={isMissing}
                    className={isMissing ? "border-destructive" : undefined}
                  />
                )}
                {isMissing && (
                  <p className="text-xs text-destructive">Required</p>
                )}

                {hasOptions && !useDropdown && (
                  <datalist id={`aspect-${a.name}`}>
                    {a.values.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
