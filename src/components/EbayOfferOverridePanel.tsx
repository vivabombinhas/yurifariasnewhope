import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Tag } from "lucide-react";
import {
  resolveProductOffer,
  updateProductOfferOverride,
} from "@/lib/marketplaces/ebay/best-offer.functions";
import {
  resolveBestOfferForProduct,
  summarizeResolved,
  validateAgainstPrice,
  type OfferMode,
  type OfferSettingsCore,
  type ProductOfferOverride,
} from "@/lib/marketplaces/ebay/best-offer";

type Props = { productId: string };

type FormState = {
  override: boolean;
  allow_offers: boolean;
  minimum_mode: OfferMode;
  minimum_percentage: string;
  minimum_amount: string;
  auto_accept_mode: OfferMode;
  auto_accept_percentage: string;
  auto_accept_amount: string;
};

function initFrom(global: OfferSettingsCore, p: ProductOfferOverride): FormState {
  const src: OfferSettingsCore = p.ebay_offer_override
    ? {
        allow_offers: p.ebay_offer_allow ?? global.allow_offers,
        minimum_mode: (p.ebay_offer_minimum_mode as OfferMode | null) ?? global.minimum_mode,
        minimum_percentage: p.ebay_offer_minimum_percentage ?? global.minimum_percentage,
        minimum_amount_cents: p.ebay_offer_minimum_amount_cents ?? global.minimum_amount_cents,
        auto_accept_mode:
          (p.ebay_offer_auto_accept_mode as OfferMode | null) ?? global.auto_accept_mode,
        auto_accept_percentage:
          p.ebay_offer_auto_accept_percentage ?? global.auto_accept_percentage,
        auto_accept_amount_cents:
          p.ebay_offer_auto_accept_amount_cents ?? global.auto_accept_amount_cents,
      }
    : global;
  return {
    override: p.ebay_offer_override,
    allow_offers: src.allow_offers,
    minimum_mode: src.minimum_mode,
    minimum_percentage: src.minimum_percentage != null ? String(src.minimum_percentage) : "",
    minimum_amount:
      src.minimum_amount_cents != null ? (src.minimum_amount_cents / 100).toFixed(2) : "",
    auto_accept_mode: src.auto_accept_mode,
    auto_accept_percentage:
      src.auto_accept_percentage != null ? String(src.auto_accept_percentage) : "",
    auto_accept_amount:
      src.auto_accept_amount_cents != null ? (src.auto_accept_amount_cents / 100).toFixed(2) : "",
  };
}

function toCore(f: FormState): OfferSettingsCore {
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

export function EbayOfferOverridePanel({ productId }: Props) {
  const qc = useQueryClient();
  const getFn = useServerFn(resolveProductOffer);
  const saveFn = useServerFn(updateProductOfferOverride);

  const q = useQuery({
    queryKey: ["ebay-offer-resolved", productId],
    queryFn: () => getFn({ data: { productId } }),
    staleTime: 15_000,
  });

  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => {
    if (q.data?.ok && form == null) {
      setForm(initFrom(q.data.global, q.data.product));
    }
  }, [q.data, form]);

  const price = q.data?.ok ? q.data.price_cents : null;
  const core = useMemo(() => (form ? toCore(form) : null), [form]);
  const validation = useMemo(
    () => (core && form?.override ? validateAgainstPrice(core, price) : null),
    [core, form?.override, price],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return { ok: false as const, errorMessage: "not ready" };
      const c = toCore(form);
      return saveFn({
        data: {
          productId,
          override: form.override,
          allow_offers: c.allow_offers,
          minimum_mode: c.minimum_mode,
          minimum_percentage: c.minimum_percentage,
          minimum_amount_cents: c.minimum_amount_cents,
          auto_accept_mode: c.auto_accept_mode,
          auto_accept_percentage: c.auto_accept_percentage,
          auto_accept_amount_cents: c.auto_accept_amount_cents,
        } as any,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ebay-offer-resolved", productId] }),
  });

  const resolvedNow = useMemo(() => {
    if (!q.data?.ok || !form) return null;
    const override: ProductOfferOverride = {
      ebay_offer_override: form.override,
      ebay_offer_allow: core?.allow_offers ?? null,
      ebay_offer_minimum_mode: core?.minimum_mode ?? null,
      ebay_offer_minimum_percentage: core?.minimum_percentage ?? null,
      ebay_offer_minimum_amount_cents: core?.minimum_amount_cents ?? null,
      ebay_offer_auto_accept_mode: core?.auto_accept_mode ?? null,
      ebay_offer_auto_accept_percentage: core?.auto_accept_percentage ?? null,
      ebay_offer_auto_accept_amount_cents: core?.auto_accept_amount_cents ?? null,
    };
    const r = resolveBestOfferForProduct(q.data.global, override, price);
    return { r, srcCore: form.override ? core! : q.data.global };
  }, [q.data, form, core, price]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Tag className="h-4 w-4" /> eBay Best Offer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {q.data && !q.data.ok && <p className="text-sm text-destructive">{q.data.errorMessage}</p>}

        {resolvedNow && (
          <p className="text-sm text-muted-foreground">
            {summarizeResolved(resolvedNow.r, price, resolvedNow.srcCore)}
          </p>
        )}

        {form && (
          <>
            <div className="flex items-center justify-between rounded-md border p-2">
              <Label className="text-sm">Override offer settings for this product</Label>
              <Switch
                checked={form.override}
                onCheckedChange={(v) => setForm((f) => (f ? { ...f, override: v } : f))}
              />
            </div>

            {form.override && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Allow offers</Label>
                  <Switch
                    checked={form.allow_offers}
                    onCheckedChange={(v) => setForm((f) => (f ? { ...f, allow_offers: v } : f))}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-sm">Minimum offer</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={form.minimum_mode}
                      onValueChange={(v) =>
                        setForm((f) => (f ? { ...f, minimum_mode: v as OfferMode } : f))
                      }
                      disabled={!form.allow_offers}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.minimum_mode === "percentage" && (
                      <Input
                        type="number" step="0.01" min="0.01" max="99.99"
                        value={form.minimum_percentage}
                        onChange={(e) =>
                          setForm((f) => (f ? { ...f, minimum_percentage: e.target.value } : f))
                        }
                        disabled={!form.allow_offers}
                      />
                    )}
                    {form.minimum_mode === "fixed" && (
                      <Input
                        type="number" step="0.01" min="0.01"
                        value={form.minimum_amount}
                        onChange={(e) =>
                          setForm((f) => (f ? { ...f, minimum_amount: e.target.value } : f))
                        }
                        disabled={!form.allow_offers}
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-sm">Auto accept</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={form.auto_accept_mode}
                      onValueChange={(v) =>
                        setForm((f) => (f ? { ...f, auto_accept_mode: v as OfferMode } : f))
                      }
                      disabled={!form.allow_offers}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.auto_accept_mode === "percentage" && (
                      <Input
                        type="number" step="0.01" min="0.01" max="100"
                        value={form.auto_accept_percentage}
                        onChange={(e) =>
                          setForm((f) => (f ? { ...f, auto_accept_percentage: e.target.value } : f))
                        }
                        disabled={!form.allow_offers}
                      />
                    )}
                    {form.auto_accept_mode === "fixed" && (
                      <Input
                        type="number" step="0.01" min="0.01"
                        value={form.auto_accept_amount}
                        onChange={(e) =>
                          setForm((f) => (f ? { ...f, auto_accept_amount: e.target.value } : f))
                        }
                        disabled={!form.allow_offers}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {validation && <p className="text-sm text-destructive">{validation}</p>}
            {save.data && !("ok" in save.data && save.data.ok) && (
              <p className="text-sm text-destructive">
                {(save.data as any).errorMessage ?? "Save failed"}
              </p>
            )}

            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || validation != null}
              size="sm"
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
