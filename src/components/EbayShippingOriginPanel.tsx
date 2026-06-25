import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getEbayShippingOrigin,
  saveEbayShippingOrigin,
  countActiveEbayListings,
  applyShippingOriginToActiveListings,
  type ApplyResult,
} from "@/lib/marketplaces/ebay/shipping-origin.functions";

export function EbayShippingOriginPanel() {
  const qc = useQueryClient();
  const getFn = useServerFn(getEbayShippingOrigin);
  const saveFn = useServerFn(saveEbayShippingOrigin);
  const countFn = useServerFn(countActiveEbayListings);
  const applyFn = useServerFn(applyShippingOriginToActiveListings);

  const q = useQuery({
    queryKey: ["ebay-shipping-origin"],
    queryFn: () => getFn(),
    staleTime: 30_000,
  });

  const view = q.data?.ok ? q.data.view : null;
  const loadError = q.data && !q.data.ok ? q.data.errorMessage : null;

  const [form, setForm] = useState({
    name: "Main Warehouse",
    addressLine1: "711 Shetland Trl",
    city: "Cartersville",
    stateOrProvince: "Georgia",
    postalCode: "30121-1705",
  });
  const [hydrated, setHydrated] = useState(false);
  if (view && view.configured && !hydrated) {
    setHydrated(true);
    setForm({
      name: view.name ?? "",
      addressLine1: view.addressLine1 ?? "",
      city: view.city ?? "",
      stateOrProvince: view.stateOrProvince ?? "",
      postalCode: view.postalCode ?? "",
    });
  }

  const [saveError, setSaveError] = useState<string | null>(null);
  const saveMut = useMutation({
    mutationFn: () => saveFn({ data: form }),
    onSuccess: (res) => {
      if (res.ok) {
        setSaveError(null);
        qc.setQueryData(["ebay-shipping-origin"], res);
      } else {
        setSaveError(res.errorMessage);
      }
    },
    onError: (e: any) => setSaveError(e?.message ?? "Request failed"),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyResults, setApplyResults] = useState<ApplyResult[] | null>(null);
  const countQuery = useQuery({
    queryKey: ["ebay-active-listings-count"],
    queryFn: () => countFn(),
    enabled: confirmOpen,
  });
  const applyMut = useMutation({
    mutationFn: () => applyFn(),
    onSuccess: (res) => {
      if (res.ok) setApplyResults(res.results);
      else setSaveError(res.errorMessage);
      setConfirmOpen(false);
    },
  });

  const human =
    view?.configured && view.city && view.stateOrProvince && view.postalCode
      ? `Shipping from: ${view.city}, ${view.stateOrProvince} ${view.postalCode}, United States`
      : null;

  const norm = (s: string | null | undefined) =>
    (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const mismatchFields: { label: string; ebay: string; form: string }[] = [];
  if (view?.configured) {
    const pairs: [string, string | null | undefined, string][] = [
      ["Name", view.name, form.name],
      ["Address", view.addressLine1, form.addressLine1],
      ["City", view.city, form.city],
      ["State", view.stateOrProvince, form.stateOrProvince],
      ["ZIP", view.postalCode, form.postalCode],
    ];
    for (const [label, ebay, formVal] of pairs) {
      if (norm(ebay) !== norm(formVal)) {
        mismatchFields.push({
          label,
          ebay: ebay ?? "—",
          form: formVal || "—",
        });
      }
    }
  }
  const hasMismatch = mismatchFields.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4" /> eBay Shipping origin
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading current
            location…
          </div>
        )}

        {loadError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
            {loadError}
          </div>
        )}

        {view && !view.configured && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600" />
            <div>
              <div className="font-medium">No shipping origin configured</div>
              <div className="text-xs text-muted-foreground">
                eBay publish will be blocked until you save an origin below.
              </div>
            </div>
          </div>
        )}

        {view?.configured && (
          <div className="rounded-md border p-3 space-y-1 bg-muted/30">
            <div className="font-medium">{human ?? "Current location"}</div>
            <div className="text-xs text-muted-foreground font-mono break-all">
              {view.name} · {view.merchantLocationKey} ·{" "}
              {(view.locationTypes ?? []).join(",") || "—"}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Badge
                variant={
                  view.merchantLocationStatus === "ENABLED"
                    ? "default"
                    : "secondary"
                }
              >
                {view.merchantLocationStatus ?? "UNKNOWN"}
              </Badge>
              {view.addressLine1 && (
                <span className="text-xs text-muted-foreground">
                  {view.addressLine1}
                </span>
              )}
            </div>
          </div>
        )}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveMut.mutate();
          }}
        >
          <div className="space-y-1">
            <Label>Location name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Address</Label>
            <Input
              value={form.addressLine1}
              onChange={(e) =>
                setForm({ ...form, addressLine1: e.target.value })
              }
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>City</Label>
              <Input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>State</Label>
              <Input
                value={form.stateOrProvince}
                onChange={(e) =>
                  setForm({ ...form, stateOrProvince: e.target.value })
                }
                placeholder="e.g. Georgia"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>ZIP code</Label>
              <Input
                value={form.postalCode}
                onChange={(e) =>
                  setForm({ ...form, postalCode: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Country</Label>
              <Input value="US" disabled readOnly />
            </div>
          </div>

          {saveError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive text-xs break-words">
              {saveError}
            </div>
          )}

          <Button type="submit" disabled={saveMut.isPending}>
            {saveMut.isPending && (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            )}
            Save eBay shipping origin
          </Button>
        </form>

        <div className="border-t pt-3 space-y-2">
          <Button
            variant="outline"
            disabled={!view?.configured}
            onClick={() => {
              setApplyResults(null);
              setConfirmOpen(true);
            }}
          >
            Apply shipping origin to active eBay listings
          </Button>

          {applyResults && (
            <div className="rounded-md border p-2 text-xs space-y-1 max-h-64 overflow-auto">
              <div className="font-medium">
                Updated {applyResults.filter((r) => r.ok).length} /{" "}
                {applyResults.length}
              </div>
              {applyResults.map((r) => (
                <div
                  key={r.listingId}
                  className="flex items-start gap-2 font-mono"
                >
                  {r.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5" />
                  )}
                  <span className="break-all">
                    {r.externalListingId ?? r.listingId}
                    {r.error ? ` — ${r.error}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Apply shipping origin to active listings?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {countQuery.isLoading
                  ? "Counting active listings…"
                  : `${countQuery.data?.count ?? 0} active eBay listing(s) will be updated with the saved shipping origin. No listings will be republished or ended.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={applyMut.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={applyMut.isPending || !countQuery.data?.count}
                onClick={(e) => {
                  e.preventDefault();
                  applyMut.mutate();
                }}
              >
                {applyMut.isPending && (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                )}
                Apply
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
