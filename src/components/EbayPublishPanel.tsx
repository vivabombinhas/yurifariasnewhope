import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Rocket, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from "lucide-react";
import { publishEbayListing } from "@/lib/marketplaces/ebay/publish.functions";
import { checkEbayReadiness } from "@/lib/marketplaces/ebay/readiness.functions";

interface Props {
  productId: string;
}

export function EbayPublishPanel({ productId }: Props) {
  const fn = useServerFn(publishEbayListing);
  const readinessFn = useServerFn(checkEbayReadiness);
  const qc = useQueryClient();

  const listing = useQuery({
    queryKey: ["ebay-listing", productId],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("marketplace_listings")
        .select("status, external_listing_id, listing_url, provider_metadata, published_at, error_message")
        .eq("product_id", productId)
        .eq("marketplace", "ebay")
        .maybeSingle();
      return data;
    },
  });

  const meta = (listing.data?.provider_metadata ?? {}) as Record<string, any>;
  const offerId: string | undefined = meta.offerId;
  const draftOutdated = !!meta.draftOutdated;

  const readiness = useQuery({
    queryKey: ["ebay-readiness", productId],
    queryFn: () => readinessFn({ data: { productId } }),
  });
  const blockingReadinessChecks =
    readiness.data?.checks.filter((c) => c.status !== "ok") ?? [];
  const readinessBlocked = blockingReadinessChecks.length > 0;
  const readinessChecking = readiness.isLoading || readiness.isFetching;

  const mut = useMutation({
    mutationFn: () => fn({ data: { productId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ebay-listing", productId] });
    },
  });

  const data = mut.data;
  const result = data?.ok ? data.result : null;

  const isActive = listing.data?.status === "active";
  const listingId =
    listing.data?.external_listing_id ?? (result?.ok ? result.listingId : undefined);
  const listingUrl: string | undefined =
    listing.data?.listing_url ??
    (meta.listingUrl as string | undefined) ??
    (listingId ? `https://www.sandbox.ebay.com/itm/${listingId}` : undefined);

  const warnings: any[] =
    (result?.raw?.json?.warnings as any[]) ??
    (result?.ok ? [] : []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Rocket className="h-4 w-4" /> Publish eBay Listing (Sandbox)
        </CardTitle>
        <div className="flex items-center gap-2">
          {isActive && listingId && (
            <Badge variant="default">Published · {listingId}</Badge>
          )}
          <Button
            size="sm"
            onClick={() => mut.mutate()}
            disabled={!offerId || mut.isPending || isActive || draftOutdated || readinessBlocked || readinessChecking}
            title={
              isActive
                ? "Listing is already active on eBay"
                : draftOutdated
                ? "Recreate the eBay draft before publishing"
                : !offerId
                ? "Create an eBay draft first"
                : readinessBlocked
                ? "Resolve eBay readiness checks before publishing"
                : readinessChecking
                ? "Checking eBay readiness before publishing"
                : undefined
            }
          >
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4 mr-1" />
            )}
            {isActive ? "Already Published" : "Publish eBay Listing (Sandbox)"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!offerId && (
          <p className="text-muted-foreground">
            Create an eBay draft first; publish needs the offerId.
          </p>
        )}
        {draftOutdated && (
          <p className="text-destructive">
            eBay draft is outdated. Recreate eBay Draft before publishing.
          </p>
        )}
        {readinessChecking && (
          <p className="text-muted-foreground">Checking eBay readiness before publishing…</p>
        )}
        {readinessBlocked && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive">
            <div className="font-medium">Publish blocked until eBay setup is valid.</div>
            <ul className="mt-1 list-disc pl-5 text-xs space-y-1">
              {blockingReadinessChecks.map((c) => (
                <li key={c.id}>{c.label}{c.detail ? ` — ${c.detail}` : ""}</li>
              ))}
            </ul>
          </div>
        )}

        {data && !data.ok && (
          <p className="text-destructive break-words">{data.errorMessage}</p>
        )}

        {isActive && listingId && (
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <div className="space-y-1">
              <div className="font-medium">Published</div>
              <div className="text-xs text-muted-foreground font-mono">
                listingId: {listingId}
              </div>
              {listingUrl && (
                <a
                  href={listingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open on eBay Sandbox
                </a>
              )}
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Warnings ({warnings.length})</span>
            </div>
            <ul className="space-y-2">
              {warnings.map((e: any, i: number) => (
                <li key={i} className="rounded border border-amber-500/30 p-2 text-xs space-y-0.5">
                  <div className="font-mono">
                    errorId: {e.errorId} · domain: {e.domain} · category: {e.category}
                  </div>
                  {e.message && <div><strong>message:</strong> {e.message}</div>}
                  {e.longMessage && (
                    <div className="text-muted-foreground">
                      <strong>longMessage:</strong> {e.longMessage}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result && !result.ok && (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 text-destructive mt-0.5" />
              <div className="font-medium">Publish failed (HTTP {result.raw.status})</div>
            </div>
            <ul className="space-y-2">
              {result.errors.map((e, i) => (
                <li key={i} className="rounded border p-2 text-xs space-y-0.5">
                  <div className="font-mono">
                    errorId: {e.errorId} · domain: {e.domain} · category: {e.category}
                  </div>
                  {e.message && <div><strong>message:</strong> {e.message}</div>}
                  {e.longMessage && (
                    <div className="text-muted-foreground">
                      <strong>longMessage:</strong> {e.longMessage}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Raw eBay response
            </summary>
            <pre className="mt-1 overflow-auto rounded bg-muted p-2 text-[10px]">
{JSON.stringify(result.raw, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
