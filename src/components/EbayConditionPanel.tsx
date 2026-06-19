import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Save, ShieldCheck } from "lucide-react";
import {
  fetchEbayConditionPoliciesForCategory,
  saveEbayCondition,
  type EbayConditionPolicyDTO,
} from "@/lib/marketplaces/ebay/taxonomy.functions";

interface Props {
  product: {
    id: string;
    condition?: string | null;
    ebay_category_id?: string | null;
    ebay_category_name?: string | null;
    ebay_condition_id?: number | null;
    ebay_condition_enum?: string | null;
    ebay_condition_name?: string | null;
    needs_condition_reselection?: boolean | null;
  };
  onSaved?: () => void;
}

// Internal condition → enums that are semantically safe to pick automatically/manually.
const INTERNAL_TO_EBAY_ENUMS: Record<string, string[]> = {
  new: ["NEW"],
  new_other: ["NEW_OTHER", "NEW"],
  like_new: ["LIKE_NEW", "PRE_OWNED_EXCELLENT", "USED_EXCELLENT"],
  excellent: ["PRE_OWNED_EXCELLENT", "USED_EXCELLENT", "USED_VERY_GOOD"],
  very_good: ["USED_VERY_GOOD", "USED_EXCELLENT", "USED_GOOD"],
  good: ["USED_GOOD", "USED_VERY_GOOD"],
  acceptable: ["USED_ACCEPTABLE"],
  for_parts: ["FOR_PARTS_OR_NOT_WORKING"],
};

export function EbayConditionPanel({ product, onSaved }: Props) {
  const qc = useQueryClient();
  const fetchFn = useServerFn(fetchEbayConditionPoliciesForCategory);
  const saveFn = useServerFn(saveEbayCondition);
  const categoryId = product.ebay_category_id ?? null;
  const needsReselection = !!product.needs_condition_reselection;
  const internalCondition = (product.condition ?? "").toLowerCase();

  const q = useQuery({
    enabled: !!categoryId,
    queryKey: ["ebay-conditions", product.id, categoryId],
    queryFn: () => fetchFn({ data: { productId: product.id } }),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const conditions = q.data?.conditions ?? [];
  const savedValue = product.ebay_condition_id ? String(product.ebay_condition_id) : "";
  const selected = conditions.find((c) => String(c.conditionId) === savedValue);
  const selectedValue = selected ? savedValue : "";
  const suggested = conditions.find((c) => c.suggested);
  const safeEnums = INTERNAL_TO_EBAY_ENUMS[internalCondition] ?? [];
  const hasSemanticMatch =
    !internalCondition ||
    safeEnums.length === 0 ||
    conditions.some((c) => safeEnums.includes(c.conditionEnum));

  const saveMut = useMutation({
    mutationFn: async (conditionId: string) => {
      const chosen = conditions.find((c) => String(c.conditionId) === conditionId);
      if (!chosen) throw new Error("Select a valid eBay Condition");
      return saveFn({
        data: {
          productId: product.id,
          conditionId: chosen.conditionId,
          conditionEnum: chosen.conditionEnum,
          conditionName: chosen.displayName,
        },
      });
    },
    onSuccess: () => {
      toast.success("eBay Condition saved");
      qc.invalidateQueries({ queryKey: ["product", product.id] });
      qc.invalidateQueries({ queryKey: ["ebay-readiness", product.id] });
      qc.invalidateQueries({ queryKey: ["ebay-listing", product.id] });
      onSaved?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save eBay Condition"),
  });

  if (!categoryId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> eBay Condition
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select an eBay category first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> eBay Condition
        </CardTitle>
        <Badge variant="secondary">Cat: {product.ebay_category_name ?? categoryId}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {needsReselection && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              Reselection required
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              The previously saved eBay condition was inconsistent (ID and enum did not match) and
              has been cleared. Pick a valid condition for this category to continue.
            </p>
          </div>
        )}
        {!hasSemanticMatch && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <p className="font-medium text-destructive">
              This category does not offer a condition equivalent to "{product.condition}".
            </p>
            <ul className="text-xs text-muted-foreground mt-2 list-disc pl-5 space-y-1">
              <li>Manually pick one of the allowed conditions below.</li>
              <li>Review the eBay category for this product.</li>
              <li>Or skip publishing this item to eBay.</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              Nothing will be selected automatically — a damaged-but-functional item should not be
              filed as "For parts or not working".
            </p>
          </div>
        )}
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading eBay conditions…</p>}
        {q.isError && (
          <p className="text-sm text-destructive">
            {(q.error as any)?.message ?? "Failed to load eBay conditions"}
          </p>
        )}
        <div className="space-y-1">
          <Label>eBay Condition</Label>
          <Select
            value={selectedValue}
            onValueChange={(value) => saveMut.mutate(value)}
            disabled={q.isLoading || saveMut.isPending || !conditions.length}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select eBay Condition…" />
            </SelectTrigger>
            <SelectContent>
              {conditions.map((c: EbayConditionPolicyDTO) => (
                <SelectItem key={`${c.conditionId}-${c.conditionEnum}`} value={String(c.conditionId)}>
                  {c.displayName}{c.suggested ? " · suggested" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {selected ? (
            <>
              <Badge variant="outline">ID {selected.conditionId}</Badge>
              <Badge variant="outline">{selected.conditionEnum}</Badge>
            </>
          ) : product.ebay_condition_name ? (
            <Badge variant="outline">Saved value not valid for this category</Badge>
          ) : null}
          {suggested && !selected && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveMut.mutate(String(suggested.conditionId))}
              disabled={saveMut.isPending}
            >
              <Save className="h-3.5 w-3.5 mr-1" /> Use suggested: {suggested.displayName}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}