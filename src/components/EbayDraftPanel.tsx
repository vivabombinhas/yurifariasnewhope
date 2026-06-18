import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { checkEbayReadiness } from "@/lib/marketplaces/ebay/readiness.functions";
import { createEbayDraft } from "@/lib/marketplaces/ebay/draft.functions";

interface Props {
  productId: string;
}

export function EbayDraftPanel({ productId }: Props) {
  const qc = useQueryClient();
  const readinessFn = useServerFn(checkEbayReadiness);
  const draftFn = useServerFn(createEbayDraft);

  const readiness = useQuery({
    queryKey: ["ebay-readiness", productId],
    queryFn: () => readinessFn({ data: { productId } }),
  });

  const listing = useQuery({
    queryKey: ["ebay-listing", productId],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("marketplace_listings")
        .select("status, error_message, provider_metadata, updated_at")
        .eq("product_id", productId)
        .eq("marketplace", "ebay")
        .maybeSingle();
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: () => {
      console.log("[EbayDraftPanel] clicked create draft", { productId });
      return draftFn({ data: { productId } });
    },
    onSuccess: (res) => {
      console.log("[EbayDraftPanel] mutation result", res);
      if (res.ok) {
        toast.success(`eBay draft created (offerId: ${res.offerId})`);
        qc.invalidateQueries({ queryKey: ["ebay-listing", productId] });
        qc.invalidateQueries({ queryKey: ["listings", productId] });
        qc.invalidateQueries({ queryKey: ["publishing-jobs"] });
      } else {
        toast.error(res.errorMessage ?? "Failed to create draft");
      }
    },
    onError: (e: any) => {
      console.error("[EbayDraftPanel] mutation error", e);
      toast.error(e?.message ?? "Failed to create draft");
    },
  });

  const ready = !!readiness.data?.ready;
  const meta =
    (listing.data?.provider_metadata as { offerId?: string; sku?: string; env?: string }) ??
    null;
  const isDraft = listing.data?.status === "draft" && !!meta?.offerId;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" /> eBay Draft (Sandbox)
        </CardTitle>
        <div className="flex items-center gap-2">
          {isDraft && <Badge variant="secondary">Draft created</Badge>}
          <Button
            size="sm"
            onClick={() => createMut.mutate()}
            disabled={!ready || createMut.isPending}
            title={!ready ? "Pass eBay Readiness checks first" : undefined}
          >
            {createMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-1" />
            )}
            {isDraft ? "Recreate eBay Draft" : "Create eBay Draft"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!ready && (
          <p className="text-muted-foreground">
            Pass all eBay Readiness checks above before creating a draft.
          </p>
        )}
        {isDraft && meta && (
          <div className="rounded-md border p-2 space-y-1">
            <div>
              <span className="text-muted-foreground">offerId: </span>
              <span className="font-mono">{meta.offerId}</span>
            </div>
            <div>
              <span className="text-muted-foreground">sku: </span>
              <span className="font-mono">{meta.sku}</span>
            </div>
            <div>
              <span className="text-muted-foreground">env: </span>
              <span className="font-mono">{meta.env ?? "sandbox"}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Unpublished offer. <code>/publish</code> was NOT called.
            </p>
          </div>
        )}
        {createMut.isPending && (
          <p className="text-muted-foreground">Creating draft…</p>
        )}
        {createMut.data?.ok && (
          <p className="text-emerald-600 dark:text-emerald-400">
            Draft created: <span className="font-mono">{createMut.data.offerId}</span>
          </p>
        )}
        {createMut.data && !createMut.data.ok && (
          <p className="text-destructive break-words">
            Draft failed: {createMut.data.errorMessage}
          </p>
        )}
        {createMut.error && (
          <p className="text-destructive break-words">
            Draft failed: {(createMut.error as any)?.message ?? String(createMut.error)}
          </p>
        )}
        {listing.data?.error_message && !createMut.isPending && (
          <p className="text-destructive break-words">
            {listing.data.error_message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
