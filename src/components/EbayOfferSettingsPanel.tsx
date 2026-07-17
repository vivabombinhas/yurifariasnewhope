import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Loader2, Tag, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  getEbayOfferSettings,
  updateEbayOfferSettings,
  applyOfferSettingsToActiveListings,
  type ApplyOfferResult,
} from "@/lib/marketplaces/ebay/best-offer.functions";
import { countActiveEbayListings } from "@/lib/marketplaces/ebay/shipping-origin.functions";
import {
  validateAgainstPrice,
  type OfferMode,
  type OfferSettingsCore,
} from "@/lib/marketplaces/ebay/best-offer";

type FormState = {
  allow_offers: boolean;
  minimum_mode: OfferMode;
  minimum_percentage: string;
  minimum_amount: string; // in dollars
  auto_accept_mode: OfferMode;
  auto_accept_percentage: string;
  auto_accept_amount: string;
};

const EMPTY: FormState = {
  allow_offers: true,
  minimum_mode: "percentage",
  minimum_percentage: "70",
  minimum_amount: "",
  auto_accept_mode: "off",
  auto_accept_percentage: "",
  auto_accept_amount: "",
};

function fromSettings(s: OfferSettingsCore): FormState {
  return {
    allow_offers: s.allow_offers,
    minimum_mode: s.minimum_mode,
    minimum_percentage: s.minimum_percentage != null ? String(s.minimum_percentage) : "",
    minimum_amount: s.minimum_amount_cents != null ? (s.minimum_amount_cents / 100).toFixed(2) : "",
    auto_accept_mode: s.auto_accept_mode,
    auto_accept_percentage:
      s.auto_accept_percentage != null ? String(s.auto_accept_percentage) : "",
    auto_accept_amount:
      s.auto_accept_amount_cents != null ? (s.auto_accept_amount_cents / 100).toFixed(2) : "",
  };
}

function toPayload(f: FormState): OfferSettingsCore {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const cents = (s: string) => {
    const n = num(s);
    return n == null ? null : Math.round(n * 100);
  };
  return {
    allow_offers: f.allow_offers,
    minimum_mode: f.minimum_mode,
    minimum_percentage: f.minimum_mode === "percentage" ? num(f.minimum_percentage) : null,
    minimum_amount_cents: f.minimum_mode === "fixed" ? cents(f.minimum_amount) : null,
    auto_accept_mode: f.auto_accept_mode,
    auto_accept_percentage:
      f.auto_accept_mode === "percentage" ? num(f.auto_accept_percentage) : null,
    auto_accept_amount_cents: f.auto_accept_mode === "fixed" ? cents(f.auto_accept_amount) : null,
  };
}

export function EbayOfferSettingsPanel() {
  const qc = useQueryClient();
  const getFn = useServerFn(getEbayOfferSettings);
  const saveFn = useServerFn(updateEbayOfferSettings);
  const countFn = useServerFn(countActiveEbayListings);
  const applyFn = useServerFn(applyOfferSettingsToActiveListings);

  const q = useQuery({
    queryKey: ["ebay-offer-settings"],
    queryFn: () => getFn(),
    staleTime: 30_000,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (q.data?.ok && !hydrated) {
      setForm(fromSettings(q.data.settings));
      setHydrated(true);
    }
  }, [q.data, hydrated]);

  const payload = useMemo(() => toPayload(form), [form]);
  const validation = useMemo(() => validateAgainstPrice(payload, null), [payload]);

  const save = useMutation({
    mutationFn: () => saveFn({ data: payload as any }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ebay-offer-settings"] }),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<ApplyOfferResult[] | null>(null);

  const openApply = async () => {
    setApplyResults(null);
    const c = await countFn();
    setActiveCount(c.count);
    setConfirmOpen(true);
  };
  const runApply = async () => {
    setApplying(true);
    try {
      const res = await applyFn();
      if (res.ok) setApplyResults(res.results);
      else setApplyResults([{ listingId: "-", productId: "-", externalListingId: null, offerId: null, ok: false, error: res.errorMessage }]);
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  };

  const autoAcceptOn = form.auto_accept_mode !== "off";
  const disabled = save.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Tag className="h-4 w-4" /> eBay Offer Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {q.isLoading && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        )}
        {q.data && !q.data.ok && (
          <p className="text-sm text-destructive">{q.data.errorMessage}</p>
        )}

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label className="text-sm">Allow offers by default</Label>
            <p className="text-xs text-muted-foreground">
              Applied to every new eBay listing unless overridden per product.
            </p>
          </div>
          <Switch
            checked={form.allow_offers}
            onCheckedChange={(v) => setForm((f) => ({ ...f, allow_offers: v }))}
            disabled={disabled}
          />
        </div>

        {/* Minimum */}
        <div className="space-y-2">
          <Label className="text-sm">Minimum offer</Label>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={form.minimum_mode}
              onValueChange={(v) => setForm((f) => ({ ...f, minimum_mode: v as OfferMode }))}
              disabled={disabled || !form.allow_offers}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="percentage">Percentage of price</SelectItem>
                <SelectItem value="fixed">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
            {form.minimum_mode === "percentage" && (
              <Input
                type="number" step="0.01" min="0.01" max="99.99"
                value={form.minimum_percentage}
                onChange={(e) => setForm((f) => ({ ...f, minimum_percentage: e.target.value }))}
                placeholder="e.g. 70"
                disabled={disabled || !form.allow_offers}
              />
            )}
            {form.minimum_mode === "fixed" && (
              <Input
                type="number" step="0.01" min="0.01"
                value={form.minimum_amount}
                onChange={(e) => setForm((f) => ({ ...f, minimum_amount: e.target.value }))}
                placeholder="USD"
                disabled={disabled || !form.allow_offers}
              />
            )}
          </div>
        </div>

        {/* Auto accept */}
        <div className="space-y-2">
          <Label className="text-sm">Auto accept</Label>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={form.auto_accept_mode}
              onValueChange={(v) => setForm((f) => ({ ...f, auto_accept_mode: v as OfferMode }))}
              disabled={disabled || !form.allow_offers}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="percentage">Percentage of price</SelectItem>
                <SelectItem value="fixed">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
            {form.auto_accept_mode === "percentage" && (
              <Input
                type="number" step="0.01" min="0.01" max="100"
                value={form.auto_accept_percentage}
                onChange={(e) => setForm((f) => ({ ...f, auto_accept_percentage: e.target.value }))}
                placeholder="e.g. 90"
                disabled={disabled || !form.allow_offers}
              />
            )}
            {form.auto_accept_mode === "fixed" && (
              <Input
                type="number" step="0.01" min="0.01"
                value={form.auto_accept_amount}
                onChange={(e) => setForm((f) => ({ ...f, auto_accept_amount: e.target.value }))}
                placeholder="USD"
                disabled={disabled || !form.allow_offers}
              />
            )}
          </div>
          {autoAcceptOn && form.allow_offers && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Auto accept can sell items automatically at or above this amount.</span>
            </div>
          )}
        </div>

        {validation && (
          <p className="text-sm text-destructive">{validation}</p>
        )}
        {save.data && !("ok" in save.data && save.data.ok) && (
          <p className="text-sm text-destructive">
            {(save.data as any).errorMessage ?? "Save failed"}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => save.mutate()}
            disabled={disabled || validation != null}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
          <Button variant="outline" onClick={openApply} disabled={disabled || applying}>
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply offer settings to active eBay listings"}
          </Button>
        </div>

        {applyResults && (
          <div className="space-y-1 text-xs">
            <p className="text-sm font-medium">Results</p>
            {applyResults.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded border p-2">
                {r.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className="font-mono">{r.externalListingId ?? r.listingId}</span>
                {r.error && <span className="text-destructive truncate">{r.error}</span>}
                {r.category === "unsupported" && (
                  <Badge variant="secondary">Category doesn't support Best Offer</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply offer settings to active listings?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeCount ?? 0} active eBay listing(s) will be updated with the current Best Offer settings.
              Nothing else on the listings will change.
              {form.auto_accept_mode !== "off" && form.allow_offers && (
                <>
                  <br />
                  <strong>Auto accept is enabled</strong> — matching offers will be accepted automatically.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runApply}>Apply</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
