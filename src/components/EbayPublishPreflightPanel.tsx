import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from "lucide-react";
import { checkEbayPublishPreflight } from "@/lib/marketplaces/ebay/publish-preflight.functions";

interface Props {
  productId: string;
}

export function EbayPublishPreflightPanel({ productId }: Props) {
  const fn = useServerFn(checkEbayPublishPreflight);
  const listing = useQuery({
    queryKey: ["ebay-listing", productId],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("marketplace_listings")
        .select("provider_metadata")
        .eq("product_id", productId)
        .eq("marketplace", "ebay")
        .maybeSingle();
      return data;
    },
  });
  const offerId = (listing.data?.provider_metadata as { offerId?: string } | null)?.offerId;
  const mut = useMutation({
    mutationFn: () => fn({ data: { productId } }),
  });

  const result = mut.data?.ok ? mut.data.result : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Publish Preflight
        </CardTitle>
        <div className="flex items-center gap-2">
          {result && (
            <Badge variant={result.ready ? "default" : "secondary"}>
              {result.ready ? "Ready to publish" : "Blocked"}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => mut.mutate()}
            disabled={!offerId || mut.isPending}
            title={!offerId ? "Create an eBay draft first" : undefined}
          >
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4 mr-1" />
            )}
            Check publish requirements
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!offerId && (
          <p className="text-muted-foreground">
            Create an eBay draft first; preflight reads the offer's listing policies and location.
          </p>
        )}
        {mut.data && !mut.data.ok && (
          <p className="text-destructive break-words">{mut.data.errorMessage}</p>
        )}
        {result && (
          <>
            <div className="text-xs text-muted-foreground">
              offerId: <span className="font-mono">{result.offerId}</span>
              {result.offerStatus && <> · status: <span className="font-mono">{result.offerStatus}</span></>}
            </div>
            <ul className="space-y-1">
              {result.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2">
                  {c.status === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                  )}
                  <div>
                    <div>{c.label}</div>
                    {c.detail && (
                      <div className="text-xs text-muted-foreground break-all font-mono">
                        {c.detail}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="text-xs text-muted-foreground pt-2 border-t">
              Available on account — locations: {result.available.locations.length}, fulfillment:{" "}
              {result.available.fulfillmentPolicies.length}, payment:{" "}
              {result.available.paymentPolicies.length}, return:{" "}
              {result.available.returnPolicies.length}
            </div>
            <p className="text-xs text-muted-foreground">
              <code>/publish</code> is NOT called here. This only inspects requirements.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
