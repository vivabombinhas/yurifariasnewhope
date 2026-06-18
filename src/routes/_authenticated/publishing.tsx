import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Send, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { listPublishingJobs } from "@/lib/publishing-jobs.functions";
import { MARKETPLACES } from "@/lib/marketplaces";

export const Route = createFileRoute("/_authenticated/publishing")({
  component: PublishingQueuePage,
});

type Status = "all" | "pending" | "processing" | "success" | "error";

const STATUS_META: Record<
  Exclude<Status, "all">,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; Icon: typeof Clock }
> = {
  pending: { label: "Pending", variant: "outline", Icon: Clock },
  processing: { label: "Processing", variant: "secondary", Icon: Loader2 },
  success: { label: "Success", variant: "default", Icon: CheckCircle2 },
  error: { label: "Error", variant: "destructive", Icon: AlertCircle },
};

function PublishingQueuePage() {
  const [status, setStatus] = useState<Status>("all");
  const fn = useServerFn(listPublishingJobs);
  const { data, isLoading, error } = useQuery({
    queryKey: ["publishing-jobs", status],
    queryFn: () => fn({ data: { status, limit: 100 } }),
    refetchInterval: 5000,
  });

  const marketplaceLabel = (id: string) =>
    MARKETPLACES.find((m) => m.id === id)?.label ?? id;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Send className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Publishing Queue</h1>
        <Badge variant="outline" className="text-[10px]">scaffold</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Jobs are recorded but not yet executed. An executor will process them in a future step.
      </p>

      <Tabs value={status} onValueChange={(v) => setStatus(v as Status)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="processing">Processing</TabsTrigger>
          <TabsTrigger value="success">Success</TabsTrigger>
          <TabsTrigger value="error">Error</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {data?.length ?? 0} job{(data?.length ?? 0) === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="text-sm text-destructive">{(error as Error).message}</div>
          ) : !data || data.length === 0 ? (
            <div className="text-sm text-muted-foreground">No jobs yet.</div>
          ) : (
            <ul className="divide-y rounded-md border">
              {data.map((j: any) => {
                const meta = STATUS_META[j.status as keyof typeof STATUS_META];
                const Icon = meta?.Icon ?? Clock;
                return (
                  <li key={j.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <div className="min-w-[200px]">
                      <div className="font-medium truncate">
                        {j.product?.title ?? "(untitled)"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {j.product?.sku}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {marketplaceLabel(j.marketplace)}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {j.action}
                    </Badge>
                    {meta && (
                      <Badge variant={meta.variant} className="text-[10px] gap-1">
                        <Icon className={`h-3 w-3 ${j.status === "processing" ? "animate-spin" : ""}`} />
                        {meta.label}
                      </Badge>
                    )}
                    {j.attempt_count > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        attempts: {j.attempt_count}
                      </span>
                    )}
                    {j.last_error && (
                      <span className="text-[11px] text-destructive max-w-xs truncate" title={j.last_error}>
                        {j.last_error}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {new Date(j.created_at).toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
