import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertTriangle, ClipboardCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkEbayReadiness } from "@/lib/marketplaces/ebay/readiness.functions";

interface Props {
  productId: string;
}

export function EbayReadinessPanel({ productId }: Props) {
  const fn = useServerFn(checkEbayReadiness);
  const q = useQuery({
    queryKey: ["ebay-readiness", productId],
    queryFn: () => fn({ data: { productId } }),
  });

  const data = q.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4" /> eBay Readiness
        </CardTitle>
        <div className="flex items-center gap-2">
          {data && (
            <Badge variant={data.ready ? "default" : "destructive"}>
              {data.ready ? "Ready for eBay Draft" : "Not ready"}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading && (
          <p className="text-sm text-muted-foreground">Checking readiness…</p>
        )}
        {q.isError && (
          <p className="text-sm text-destructive">
            {(q.error as any)?.message ?? "Failed to check readiness"}
          </p>
        )}
        {data && (
          <ul className="space-y-2">
            {data.checks.map((c) => {
              const Icon =
                c.status === "ok"
                  ? CheckCircle2
                  : c.status === "warning"
                    ? AlertTriangle
                    : XCircle;
              const color =
                c.status === "ok"
                  ? "text-emerald-600"
                  : c.status === "warning"
                    ? "text-amber-600"
                    : "text-destructive";
              return (
                <li
                  key={c.id}
                  className="flex items-start justify-between gap-3 rounded-md border p-2"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{c.label}</div>
                      {c.detail && (
                        <div className="text-xs text-muted-foreground break-words">
                          {c.detail}
                        </div>
                      )}
                    </div>
                  </div>
                  {c.status !== "ok" && c.action && (
                    <Badge variant="outline" className="shrink-0">
                      {c.action}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
