import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CheckCircle2, Plug, Send, Settings2, AlertCircle } from "lucide-react";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import { checkEbayReadiness } from "@/lib/marketplaces/ebay/readiness.functions";
import { EbayCategoryPanel } from "@/components/EbayCategoryPanel";
import { EbayConditionPanel } from "@/components/EbayConditionPanel";
import { EbayAspectsPanel } from "@/components/EbayAspectsPanel";
import { EbayReadinessPanel } from "@/components/EbayReadinessPanel";
import { EbayDraftPanel } from "@/components/EbayDraftPanel";
import { EbayPublishPreflightPanel } from "@/components/EbayPublishPreflightPanel";
import { EbaySellerSetupPanel } from "@/components/EbaySellerSetupPanel";
import { EbayPublishPanel } from "@/components/EbayPublishPanel";
import { EbayPublishAuditPanel } from "@/components/EbayPublishAuditPanel";

interface Props {
  productId: string;
  product: any;
  onSaved: () => void;
}

export function MarketplacePublishingPanel({ productId, product, onSaved }: Props) {
  const [openValue, setOpenValue] = useState<string>("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" /> Marketplace Publishing
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Accordion
          type="single"
          collapsible
          value={openValue}
          onValueChange={setOpenValue}
          className="w-full"
        >
          {MARKETPLACES.map((m) => (
            <AccordionItem key={m.id} value={m.id}>
              <MarketplaceRow
                marketplace={m.id}
                label={m.label}
                productId={productId}
                isOpen={openValue === m.id}
              />
              <AccordionContent>
                {m.id === "ebay" ? (
                  <div className="space-y-4 pt-2">
                    <EbayCategoryPanel product={product} onSaved={onSaved} />
                    <EbayConditionPanel product={product} onSaved={onSaved} />
                    <EbayAspectsPanel product={product} onSaved={onSaved} />
                    <EbayReadinessPanel productId={productId} />
                    <EbayDraftPanel productId={productId} />
                    <EbaySellerSetupPanel productId={productId} />
                    <EbayPublishPreflightPanel productId={productId} />
                    <EbayPublishAuditPanel productId={productId} />
                    <EbayPublishPanel productId={productId} />
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground p-3">
                    {m.label} integration is not implemented yet.
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function MarketplaceRow({
  marketplace,
  label,
  productId,
  isOpen,
}: {
  marketplace: MarketplaceId;
  label: string;
  productId: string;
  isOpen: boolean;
}) {
  // Only eBay has a real readiness check for now
  const readinessFn = useServerFn(checkEbayReadiness);
  const readiness = useQuery({
    enabled: marketplace === "ebay",
    queryKey: ["ebay-readiness", productId],
    queryFn: () => readinessFn({ data: { productId } }),
    staleTime: 30_000,
  });

  let status: "not_connected" | "missing" | "ready" | "loading" = "not_connected";
  let missingCount = 0;

  if (marketplace === "ebay") {
    if (readiness.isLoading) status = "loading";
    else if (readiness.data) {
      const missing = readiness.data.checks.filter((c) => c.status !== "ok");
      missingCount = missing.length;
      const accountMissing = readiness.data.checks.find(
        (c) => c.id === "account" && c.status !== "ok",
      );
      if (accountMissing) status = "not_connected";
      else status = missingCount === 0 ? "ready" : "missing";
    }
  }

  const badge = (() => {
    if (status === "loading") return <Badge variant="outline">Checking…</Badge>;
    if (status === "not_connected")
      return (
        <Badge variant="outline" className="gap-1">
          <Plug className="h-3 w-3" /> Not connected
        </Badge>
      );
    if (status === "ready")
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> Ready
        </Badge>
      );
    if (status === "missing")
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" /> {missingCount} missing
        </Badge>
      );
    return null;
  })();

  return (
    <AccordionTrigger className="hover:no-underline">
      <div className="flex w-full items-center justify-between gap-3 pr-2">
        <div className="font-medium text-sm">{label}</div>
        <div className="flex items-center gap-2">
          {badge}
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Settings2 className="h-3.5 w-3.5" />
            {isOpen ? "Hide" : "Configure"}
          </span>
        </div>
      </div>
    </AccordionTrigger>
  );
}
