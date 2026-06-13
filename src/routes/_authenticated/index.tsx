import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PRODUCT_STATUSES, formatStatus } from "@/lib/marketplaces";
import { PackagePlus } from "lucide-react";

import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — Inventory" }] }),
  component: Dashboard,
  errorComponent: RouteError,
});

function Dashboard() {
  const { data: counts } = useQuery({
    queryKey: ["dashboard", "status-counts"],
    queryFn: async () => {
      const results = await Promise.all(
        PRODUCT_STATUSES.map(async (s) => {
          const { count } = await supabase
            .from("products")
            .select("*", { count: "exact", head: true })
            .eq("status", s);
          return [s, count ?? 0] as const;
        }),
      );
      return Object.fromEntries(results) as Record<string, number>;
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["dashboard", "recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, sku, title, status, created_at")
        .order("created_at", { ascending: false })
        .limit(8);
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Button asChild>
          <Link to="/products/new">
            <PackagePlus className="h-4 w-4 mr-2" /> New product
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {PRODUCT_STATUSES.map((s) => (
          <Card key={s}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {formatStatus(s)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{counts?.[s] ?? "—"}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent items</CardTitle>
        </CardHeader>
        <CardContent>
          {recent?.length ? (
            <ul className="divide-y">
              {recent.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/products/$id"
                    params={{ id: p.id }}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40 -mx-2 px-2 rounded"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {p.title || "Untitled"}
                      </div>
                      <div className="text-xs text-muted-foreground">{p.sku}</div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatStatus(p.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No items yet. Create your first one.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
