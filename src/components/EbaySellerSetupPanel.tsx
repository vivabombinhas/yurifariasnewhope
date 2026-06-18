import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, Store, RefreshCcw, AlertCircle } from "lucide-react";
import {
  getEbaySellerSetup,
  createEbaySellerResource,
  syncEbayOfferWithSellerSetup,
} from "@/lib/marketplaces/ebay/seller-setup.functions";

interface Props {
  productId: string;
}

type ResourceKey = "location" | "fulfillmentPolicy" | "paymentPolicy" | "returnPolicy";

const CREATE_LABEL: Record<ResourceKey, string> = {
  location: "Create Sandbox Location",
  fulfillmentPolicy: "Create Fulfillment Policy",
  paymentPolicy: "Create Payment Policy",
  returnPolicy: "Create Return Policy",
};

export function EbaySellerSetupPanel({ productId }: Props) {
  const qc = useQueryClient();
  const getFn = useServerFn(getEbaySellerSetup);
  const createFn = useServerFn(createEbaySellerResource);
  const syncFn = useServerFn(syncEbayOfferWithSellerSetup);

  const [errors, setErrors] = useState<Partial<Record<ResourceKey, string>>>({});

  const query = useQuery({
    queryKey: ["ebay-seller-setup"],
    queryFn: () => getFn(),
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: async (resource: ResourceKey) => {
      const res = await createFn({ data: { resource: resource as any } });
      return { resource, res };
    },
    onSuccess: ({ resource, res }) => {
      if (res.ok) {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[resource];
          return next;
        });
        qc.setQueryData(["ebay-seller-setup"], res);
      } else {
        setErrors((prev) => ({ ...prev, [resource]: res.errorMessage || "Unknown error" }));
      }
    },
    onError: (err: any, resource) => {
      setErrors((prev) => ({ ...prev, [resource]: err?.message || "Request failed" }));
    },
  });

  const syncMut = useMutation({
    mutationFn: () => syncFn({ data: { productId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ebay-listing", productId] });
    },
  });

  const status = query.data?.ok ? query.data.status : null;
  const error = query.data && !query.data.ok ? query.data.errorMessage : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Store className="h-4 w-4" /> eBay Seller Setup (Sandbox)
        </CardTitle>
        <div className="flex items-center gap-2">
          {status && (
            <Badge variant={status.ready ? "default" : "secondary"}>
              {status.ready ? "Ready for Publish" : "Setup incomplete"}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4 mr-1" />
            )}
            Check Seller Setup
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <p className="text-destructive break-words">{error}</p>}
        {createError && <p className="text-destructive break-words">{createError}</p>}
        {syncMut.data && !syncMut.data.ok && (
          <p className="text-destructive break-words">{syncMut.data.errorMessage}</p>
        )}
        {syncMut.data?.ok && (
          <p className="text-emerald-600 dark:text-emerald-400">
            Offer updated with seller setup defaults. Re-run preflight.
          </p>
        )}
        {status && (
          <ul className="space-y-2">
            {status.items.map((item) => {
              const isPending =
                createMut.isPending && (createMut.variables as string) === item.key;
              return (
                <li key={item.key} className="flex items-center justify-between gap-2">
                  <div className="flex items-start gap-2">
                    {item.status === "exists" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                    )}
                    <div>
                      <div>{item.label}</div>
                      <div className="text-xs text-muted-foreground font-mono break-all">
                        {item.status === "exists"
                          ? `${item.name ?? ""} ${item.id ? `· ${item.id}` : ""} (${item.count})`
                          : "Missing"}
                      </div>
                    </div>
                  </div>
                  {item.status === "missing" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => createMut.mutate(item.key)}
                    >
                      {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                      {CREATE_LABEL[item.key]}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {status?.ready && (
          <div className="pt-2 border-t">
            <Button
              size="sm"
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending}
            >
              {syncMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Apply seller setup to current draft offer
            </Button>
            <p className="text-xs text-muted-foreground mt-1">
              Updates the unpublished Offer with the default location and policies so preflight flips to Ready.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
