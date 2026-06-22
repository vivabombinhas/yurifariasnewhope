import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  syncEbayOrdersNow,
  getEbayOrdersSyncStatus,
} from "@/lib/marketplaces/ebay/sync-orders.functions";

function fmt(ts?: string | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function EbayOrdersSyncPanel() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getEbayOrdersSyncStatus);
  const runSync = useServerFn(syncEbayOrdersNow);
  const [busy, setBusy] = useState<"dry" | "real" | null>(null);

  const { data } = useQuery({
    queryKey: ["ebay-orders-sync-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 30_000,
  });

  if (!data?.connected) return null;

  const handleRun = async (dryRun: boolean) => {
    setBusy(dryRun ? "dry" : "real");
    try {
      const res = await runSync({ data: { dryRun } });
      const summary =
        `Orders: ${res.ordersFetched} · Line items: ${res.lineItemsProcessed} · ` +
        `Sales: ${res.salesRecorded} · Already: ${res.alreadyProcessed} · ` +
        `Unmatched: ${res.unmatchedItems}`;
      if (res.status === "success") {
        toast.success(dryRun ? `Dry run OK — ${summary}` : `Sync OK — ${summary}`);
      } else if (res.status === "partial") {
        toast.warning(`Partial — ${summary}`);
      } else {
        toast.error(
          `Sync failed: ${res.errors[0]?.message ?? "see status"} — ${summary}`,
        );
      }
      qc.invalidateQueries({ queryKey: ["ebay-orders-sync-status"] });
    } catch (e: any) {
      toast.error(`Sync error: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const needsReconnect =
    data.accountStatus === "needs_reconnect" ||
    data.lastStatus === "needs_reconnect";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">eBay sales sync</CardTitle>
        {needsReconnect ? (
          <Badge variant="destructive">Reconnect required</Badge>
        ) : data.lastStatus === "success" ? (
          <Badge variant="secondary">OK</Badge>
        ) : data.lastStatus ? (
          <Badge variant="outline">{data.lastStatus}</Badge>
        ) : (
          <Badge variant="outline">Idle</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-y-1 gap-x-4">
          <span className="text-muted-foreground">Last successful sync</span>
          <span>{fmt(data.lastSuccessAt)}</span>
          <span className="text-muted-foreground">Last attempt</span>
          <span>{fmt(data.lastAttemptAt)}</span>
          <span className="text-muted-foreground">Sales found (24h)</span>
          <span>{data.salesLast24h}</span>
          <span className="text-muted-foreground">Unmatched (24h)</span>
          <span>{data.unmatchedLast24h}</span>
          {data.lockHeld ? (
            <>
              <span className="text-muted-foreground">Lock held since</span>
              <span>{fmt(data.lockHeldAt)}</span>
            </>
          ) : null}
        </div>

        {data.lastError ? (
          <pre className="bg-muted text-xs p-2 rounded overflow-auto max-h-32">
            {JSON.stringify(data.lastError, null, 2)}
          </pre>
        ) : null}

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy || needsReconnect}
            onClick={() => handleRun(true)}
          >
            {busy === "dry" ? "Running…" : "Dry run"}
          </Button>
          <Button
            size="sm"
            disabled={!!busy || needsReconnect}
            onClick={() => handleRun(false)}
          >
            {busy === "real" ? "Syncing…" : "Sync orders now"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Manual sync respects a 60-second cooldown and the same per-account
          lock used by the scheduled cron.
        </p>
      </CardContent>
    </Card>
  );
}
