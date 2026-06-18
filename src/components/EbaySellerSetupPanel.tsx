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
  getEbayOptedInPrograms,
  optInEbayBusinessPolicies,
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
  const getOptInFn = useServerFn(getEbayOptedInPrograms);
  const optInFn = useServerFn(optInEbayBusinessPolicies);

  const [errors, setErrors] = useState<Partial<Record<ResourceKey, string>>>({});
  const [optInError, setOptInError] = useState<{ message: string; raw?: any } | null>(null);

  const optInQuery = useQuery({
    queryKey: ["ebay-opt-in-programs"],
    queryFn: () => getOptInFn(),
    staleTime: 30_000,
  });

  const optInMut = useMutation({
    mutationFn: () => optInFn(),
    onSuccess: (res) => {
      if (res.ok) {
        setOptInError(null);
        qc.setQueryData(["ebay-opt-in-programs"], res);
        qc.invalidateQueries({ queryKey: ["ebay-seller-setup"] });
      } else {
        setOptInError({ message: res.errorMessage, raw: (res as any).raw });
      }
    },
    onError: (err: any) => {
      setOptInError({ message: err?.message ?? "Request failed" });
    },
  });

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
        {syncMut.data && !syncMut.data.ok && (
          <p className="text-destructive break-words">{syncMut.data.errorMessage}</p>
        )}
        {syncMut.data?.ok && (
          <p className="text-emerald-600 dark:text-emerald-400">
            Offer updated with seller setup defaults. Re-run preflight.
          </p>
        )}
        {status && (
          <ul className="space-y-3">
            {status.items.map((item) => {
              const key = item.key as ResourceKey;
              const isPending =
                createMut.isPending && (createMut.variables as ResourceKey) === key;
              const itemError = errors[key];
              const hasError = item.status === "missing" && !!itemError;
              return (
                <li key={item.key} className="flex flex-col gap-1.5 border-b last:border-b-0 pb-2 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-start gap-2">
                      {item.status === "exists" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                      ) : hasError ? (
                        <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                      )}
                      <div>
                        <div>{item.label}</div>
                        <div className="text-xs text-muted-foreground font-mono break-all">
                          {item.status === "exists"
                            ? `${item.name ?? ""} ${item.id ? `· ${item.id}` : ""} (${item.count})`
                            : hasError
                            ? "Failed"
                            : "Missing"}
                        </div>
                      </div>
                    </div>
                    {item.status === "missing" && (
                      <Button
                        size="sm"
                        variant={hasError ? "destructive" : "outline"}
                        disabled={isPending}
                        onClick={() => createMut.mutate(key)}
                      >
                        {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                        {hasError ? (
                          <>
                            <RefreshCcw className="h-4 w-4 mr-1" /> Retry
                          </>
                        ) : (
                          CREATE_LABEL[key]
                        )}
                      </Button>
                    )}
                  </div>
                  {hasError && (
                    <div className="ml-6 rounded-md bg-destructive/10 border border-destructive/30 px-2 py-1.5 text-xs text-destructive break-words">
                      {itemError}
                    </div>
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
