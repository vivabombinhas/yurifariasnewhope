import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Loader2, Send, AlertCircle, CheckCircle2, Plug } from "lucide-react";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import { PUBLISHERS } from "@/lib/marketplaces/registry";
import { publishToMarketplace } from "@/lib/marketplaces/publish.functions";
import type { PublishStatus } from "@/lib/marketplaces/types";

type ListingRow = {
  id: string;
  marketplace: MarketplaceId;
  status: string;
  external_listing_id: string | null;
  listing_url: string | null;
  published_at: string | null;
  last_sync_at: string | null;
  error_message: string | null;
};

function deriveStatus(
  row: ListingRow | undefined,
  isConnected: boolean,
): PublishStatus {
  if (row?.error_message && !row.published_at) return "error";
  if (row?.published_at) return "published";
  if (isConnected) return "ready";
  return "not_connected";
}

const STATUS_META: Record<
  PublishStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; Icon: typeof Plug }
> = {
  not_connected: { label: "Not Connected", variant: "outline", Icon: Plug },
  ready: { label: "Ready", variant: "secondary", Icon: CheckCircle2 },
  published: { label: "Published", variant: "default", Icon: Send },
  error: { label: "Error", variant: "destructive", Icon: AlertCircle },
};

export function PublishPanel({
  productId,
  rows,
  onChange,
}: {
  productId: string;
  rows: ListingRow[];
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const publishFn = useServerFn(publishToMarketplace);
  const [pending, setPending] = useState<MarketplaceId | null>(null);

  const byMarketplace = useMemo(() => {
    const m = new Map<MarketplaceId, ListingRow>();
    rows.forEach((r) => m.set(r.marketplace, r));
    return m;
  }, [rows]);

  const publish = useMutation({
    mutationFn: (marketplace: MarketplaceId) => {
      setPending(marketplace);
      return publishFn({ data: { productId, marketplace } });
    },
    onSuccess: (res) => {
      if (res.not_implemented) {
        toast.info(res.message ?? "Publish intent recorded.");
      } else if (res.ok) {
        toast.success("Published.");
      } else {
        toast.error(res.message ?? "Publish failed.");
      }
      void qc.invalidateQueries({ queryKey: ["listings", productId] });
      onChange();
    },
    onError: (e: any) => toast.error(e?.message ?? "Publish failed"),
    onSettled: () => setPending(null),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" /> Publish to marketplaces
          <Badge variant="outline" className="text-[10px] ml-1">scaffold</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Integrations are not wired yet. Clicking <strong>Publish</strong> records
          the intent in your listings so a future executor can push the listing.
        </p>
        <ul className="divide-y rounded-md border">
          {MARKETPLACES.map((m) => {
            const row = byMarketplace.get(m.id);
            const publisher = PUBLISHERS[m.id];
            const isConnected = publisher.isConnected();
            const status = deriveStatus(row, isConnected);
            const meta = STATUS_META[status];
            const Icon = meta.Icon;
            const busy = pending === m.id && publish.isPending;
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-3 p-3"
              >
                <div className="min-w-[140px] font-medium text-sm">{m.label}</div>
                <Badge variant={meta.variant} className="text-[10px] gap-1">
                  <Icon className="h-3 w-3" />
                  {meta.label}
                </Badge>
                {row?.error_message && status !== "published" && (
                  <span className="text-[11px] text-destructive max-w-xs truncate" title={row.error_message}>
                    {row.error_message}
                  </span>
                )}
                {row?.published_at && (
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(row.published_at).toLocaleString()}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {row?.listing_url && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={row.listing_url} target="_blank" rel="noreferrer" aria-label="Open listing">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => publish.mutate(m.id)}
                    disabled={busy}
                    aria-busy={busy}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-1" />
                    )}
                    {row?.published_at ? "Re-publish" : "Publish"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
