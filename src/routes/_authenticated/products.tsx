import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PRODUCT_STATUSES,
  formatPrice,
  formatStatus,
} from "@/lib/marketplaces";
import { PackagePlus, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Products — Inventory" }] }),
  component: ProductsPage,
});

function ProductsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["products", { q, status }],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select(
          "id, sku, title, status, price_cents, currency, location:locations(label), brand:brands(name)",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (status !== "all") query = query.eq("status", status as any);
      if (q.trim()) query = query.or(`title.ilike.%${q}%,sku.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Products</h1>
        <Button asChild size="sm">
          <Link to="/products/new">
            <PackagePlus className="h-4 w-4 mr-2" /> New
          </Link>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title or SKU"
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
            <SelectItem value="all">All statuses</SelectItem>
            {PRODUCT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {formatStatus(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border bg-background">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : !data?.length ? (
          <p className="p-6 text-sm text-muted-foreground">No products found.</p>
        ) : (
          <ul className="divide-y">
            {data.map((p: any) => (
              <li key={p.id}>
                <Link
                  to="/products/$id"
                  params={{ id: p.id }}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.title || "Untitled"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.sku}
                      {p.brand?.name ? ` · ${p.brand.name}` : ""}
                      {p.location?.label ? ` · ${p.location.label}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-sm font-medium">
                      {formatPrice(p.price_cents, p.currency)}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {formatStatus(p.status)}
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
