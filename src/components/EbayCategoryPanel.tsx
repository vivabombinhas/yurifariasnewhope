import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, Search, Tag } from "lucide-react";
import {
  fetchEbayCategorySuggestions,
  saveEbayCategory,
  type EbayCategorySuggestionDTO,
} from "@/lib/marketplaces/ebay/taxonomy.functions";

interface Props {
  product: {
    id: string;
    title: string | null;
    ebay_category_id?: string | null;
    ebay_category_name?: string | null;
    ebay_category_confidence?: number | null;
  };
  onSaved?: () => void;
}

export function EbayCategoryPanel({ product, onSaved }: Props) {
  const qc = useQueryClient();
  const fetchFn = useServerFn(fetchEbayCategorySuggestions);
  const saveFn = useServerFn(saveEbayCategory);
  const [suggestions, setSuggestions] = useState<EbayCategorySuggestionDTO[] | null>(null);

  const findMut = useMutation({
    mutationFn: async () => {
      const q = (product.title ?? "").trim();
      if (!q) throw new Error("Set a product title first");
      return fetchFn({ data: { productId: product.id, query: q } });
    },
    onSuccess: (res) => {
      setSuggestions(res.suggestions);
      if (!res.suggestions.length) toast.info("No suggestions returned by eBay");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to fetch eBay categories"),
  });

  const selectMut = useMutation({
    mutationFn: async (s: EbayCategorySuggestionDTO) =>
      saveFn({
        data: {
          productId: product.id,
          categoryId: s.categoryId,
          categoryName: s.categoryName,
          source: "ebay_taxonomy_api",
        },
      }),
    onSuccess: () => {
      toast.success("eBay category saved");
      qc.invalidateQueries({ queryKey: ["product", product.id] });
      onSaved?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save category"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Tag className="h-4 w-4" /> eBay Category
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => findMut.mutate()}
          disabled={findMut.isPending}
        >
          <Search className="h-4 w-4 mr-1" />
          {findMut.isPending ? "Searching…" : "Find eBay Categories"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          <div className="text-muted-foreground">Current category</div>
          {product.ebay_category_id ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="font-medium">{product.ebay_category_name}</span>
              <Badge variant="secondary">ID: {product.ebay_category_id}</Badge>
              {typeof product.ebay_category_confidence === "number" && (
                <Badge variant="outline">
                  conf {Math.round((product.ebay_category_confidence ?? 0) * 100)}%
                </Badge>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground italic mt-1">Not set</div>
          )}
        </div>

        {(() => {
          const mismatch = detectCategoryMismatch(product.title, product.ebay_category_name);
          if (!mismatch) return null;
          return (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">This eBay category may not match this product.</div>
                <div className="text-xs">
                  Title looks like <b>{mismatch.productKind}</b> but selected category is{" "}
                  <b>{product.ebay_category_name}</b>. Click <b>Find eBay Categories</b> to pick a better one.
                </div>
              </div>
            </div>
          );
        })()}


        {suggestions && (
          <div>
            <div className="text-sm font-medium mb-2">Suggested categories</div>
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suggestions.</p>
            ) : (
              <ul className="space-y-2">
                {suggestions.map((s) => {
                  const path = [
                    ...(s.ancestors ?? []).map((a) => a.categoryName),
                    s.categoryName,
                  ].join(" › ");
                  const isSelected = product.ebay_category_id === s.categoryId;
                  return (
                    <li
                      key={s.categoryId}
                      className="flex items-center justify-between gap-3 rounded-md border p-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.categoryName}</div>
                        <div className="text-xs text-muted-foreground truncate">{path}</div>
                        <div className="text-xs text-muted-foreground">
                          ID: {s.categoryId} · level {s.categoryTreeNodeLevel}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={isSelected ? "secondary" : "default"}
                        disabled={selectMut.isPending}
                        onClick={() => selectMut.mutate(s)}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
