import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Rocket, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from "lucide-react";
import { publishEbayListing } from "@/lib/marketplaces/ebay/publish.functions";

interface Props {
  productId: string;
}

export function EbayPublishPanel({ productId }: Props) {
  const fn = useServerFn(publishEbayListing);
  const qc = useQueryClient();

  const listing = useQuery({
    queryKey: ["ebay-listing", productId],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("marketplace_listings")
        .select("status, external_listing_id, provider_metadata, published_at, error_message")
        .eq("product_id", productId)
        .eq("marketplace", "ebay")
        .maybeSingle();
      return data;
    },
  });

  const meta = (listing.data?.provider_metadata ?? {}) as Record<string, any>;
  const offerId: string | undefined = meta.offerId;

  const mut = useMutation({
    mutationFn: () => fn({ data: { productId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ebay-listing", productId] });
    },
  });

  const data = mut.data;
  const result = data?.ok ? data.result : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Rocket className="h-4 w-4" /> Publish eBay Listing (Sandbox)
        </CardTitle>
        <div className="flex items-center gap-2">
          {listing.data?.external_listing_id && (
            <Badge variant="default">Published · {listing.data.external_listing_id}</Badge>
          )}
          <Button
            size="sm"
            onClick={() => mut.mutate()}
            disabled={!offerId || mut.isPending}
            title={!offerId ? "Create an eBay draft first" : undefined}
          >
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4 mr-1" />
            )}
            Publish eBay Listing (Sandbox)
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!offerId && (
          <p className="text-muted-foreground">
            Create an eBay draft first; publish needs the offerId.
          </p>
        )}

        {data && !data.ok && (
          <p className="text-destructive break-words">{data.errorMessage}</p>
        )}

        {result?.ok && (
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <div>
              <div>Published</div>
              <div className="text-xs text-muted-foreground font-mono">
                listingId: {result.listingId}
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                offerId: {offerId} · marketplace: ebay
              </div>
            </div>
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
