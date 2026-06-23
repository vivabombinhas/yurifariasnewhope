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
import { EbayWorkflowPanel } from "@/components/ebay/EbayWorkflowPanel";
import { AssistedPublishPanel } from "@/components/AssistedPublishPanel";
import { supabase } from "@/integrations/supabase/client";
import { Tag, ShoppingBag } from "lucide-react";

const ASSISTED: MarketplaceId[] = ["facebook_marketplace", "poshmark", "depop"];

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
                  <div className="pt-2">
                    <EbayWorkflowPanel
                      productId={productId}
                      product={product}
                      onSaved={onSaved}
                    />
                  </div>
                ) : ASSISTED.includes(m.id) ? (
                  <AssistedPublishPanel
                    marketplace={m.id}
                    productId={productId}
                    onSaved={onSaved}
                  />
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
  // eBay has a real readiness check; assisted marketplaces use the listing row.
  const readinessFn = useServerFn(checkEbayReadiness);
  const readiness = useQuery({
    enabled: marketplace === "ebay",
    queryKey: ["ebay-readiness", productId],
    queryFn: () => readinessFn({ data: { productId } }),
    staleTime: 30_000,
  });

  const isAssisted = ASSISTED.includes(marketplace);
  const assistedListing = useQuery({
    enabled: isAssisted,
    queryKey: ["assisted-listing-status", marketplace, productId],
    queryFn: async () => {
      const { data } = await supabase
        .from("marketplace_listings")
        .select("status, listing_url")
        .eq("product_id", productId)
        .eq("marketplace", marketplace)
        .maybeSingle();
      return data;
    },
    staleTime: 10_000,
  });

  const badge = (() => {
    if (marketplace === "ebay") {
      if (readiness.isLoading) return <Badge variant="outline">Checking…</Badge>;
      if (!readiness.data) return null;
      const missing = readiness.data.checks.filter((c) => c.status !== "ok");
      const accountMissing = readiness.data.checks.find(
        (c) => c.id === "account" && c.status !== "ok",
      );
      if (accountMissing)
        return (
          <Badge variant="outline" className="gap-1">
            <Plug className="h-3 w-3" /> Not connected
          </Badge>
        );
      if (missing.length === 0)
        return (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Ready
          </Badge>
        );
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" /> {missing.length} missing
        </Badge>
      );
    }
    if (isAssisted) {
      const s = assistedListing.data?.status;
      if (s === "sold")
        return (
          <Badge variant="secondary" className="gap-1">
            <ShoppingBag className="h-3 w-3" /> Sold
          </Badge>
        );
      if (s === "active")
        return (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Published
          </Badge>
        );
      if (s === "draft")
        return (
          <Badge variant="outline" className="gap-1">
            <Tag className="h-3 w-3" /> Ready to post
          </Badge>
        );
      return <Badge variant="outline">Not prepared</Badge>;
    }
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
