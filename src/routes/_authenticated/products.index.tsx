import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  PRODUCT_STATUSES,
  formatPrice,
} from "@/lib/marketplaces";
import { Layers, PackagePlus, Search, Trash2 } from "lucide-react";
import { useT, tStatus } from "@/lib/i18n";
import { toast } from "sonner";

import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/products/")({
  head: () => ({ meta: [{ title: "Products — Inventory" }] }),
  component: ProductsPage,
  errorComponent: RouteError,
});


function ProductsPage() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["products", { status }],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select(
          "id, sku, title, status, price_cents, currency, location:locations(label), brand:brands(name), category:categories(name)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (status !== "all") query = query.eq("status", status as any);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const term = q.trim().toLowerCase();
  const filtered = !term
    ? data
    : data?.filter((p: any) => {
        const hay = [
          p.sku,
          p.title,
          p.brand?.name,
          p.category?.name,
          p.location?.label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(term);
      });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected =
    !!filtered?.length && filtered.every((p: any) => selected.has(p.id));

  const toggleAll = () => {
    if (!filtered) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((p: any) => next.delete(p.id));
      } else {
        filtered.forEach((p: any) => next.add(p.id));
      }
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setDeleting(true);
    try {
      // Best-effort: clean up photos from storage
      const { data: photos } = await supabase
        .from("product_photos")
        .select("storage_path")
        .in("product_id", ids);
      const paths = (photos ?? [])
        .map((p: any) => p.storage_path)
        .filter(Boolean);
      if (paths.length) {
        await supabase.storage.from("product-photos").remove(paths);
      }
      const { error } = await supabase.from("products").delete().in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} deleted`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("products.title")}</h1>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/products/batch">
              <Layers className="h-4 w-4 mr-2" /> Batch
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/products/new">
              <PackagePlus className="h-4 w-4 mr-2" /> {t("nav.new")}
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("products.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("products.allStatuses")}</SelectItem>
            {PRODUCT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {tStatus(t, s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered?.length ? (
        <div className="flex items-center justify-between gap-2 px-1">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={toggleAll}
            />
            {selected.size > 0
              ? `${selected.size} selected`
              : "Select all"}
          </label>
          {selected.size > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" disabled={deleting}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete {selected.size}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete {selected.size} product{selected.size > 1 ? "s" : ""}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the selected products and their
                    photos. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleBulkDelete}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      ) : null}

      <div className="rounded-md border bg-background">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !filtered?.length ? (
          <p className="p-6 text-sm text-muted-foreground">{t("products.none")}</p>
        ) : (
          <ul className="divide-y">
            {filtered.map((p: any) => (
              <li
                key={p.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
              >
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                  aria-label="Select product"
                />
                <Link
                  to="/products/$id"
                  params={{ id: p.id }}
                  className="flex flex-1 items-center justify-between gap-3 min-w-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.title || t("common.untitled")}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.sku}
                      {p.brand?.name ? ` · ${p.brand.name}` : ""}
                      {p.category?.name ? ` · ${p.category.name}` : ""}
                      {p.location?.label ? ` · ${p.location.label}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-sm font-medium">
                      {formatPrice(p.price_cents, p.currency)}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {tStatus(t, p.status)}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

