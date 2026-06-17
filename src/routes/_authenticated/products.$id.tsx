import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getUnsupportedImageMessage, prepareImageForUpload, isAiSupportedPath } from "@/lib/image-convert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LISTING_STATUSES,
  MARKETPLACES,
  PRODUCT_CONDITIONS,
  PRODUCT_STATUSES,
  formatPrice,
  type MarketplaceId,
} from "@/lib/marketplaces";
import { toast } from "sonner";
import { ArrowLeft, ArrowLeft as ArrLeft, ArrowRight, Copy, ExternalLink, ImagePlus, Trash2, X } from "lucide-react";
import { AiSuggestionPanel } from "@/components/AiSuggestionPanel";
import { PublishPanel } from "@/components/PublishPanel";
import { useT, tStatus, tCondition } from "@/lib/i18n";

import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/products/$id")({
  head: () => ({ meta: [{ title: "Product — Inventory" }] }),
  component: ProductDetail,
  errorComponent: RouteError,
  notFoundComponent: () => <ProductNotFound />,
});

function ProductNotFound() {
  const t = useT();
  return (
    <p className="text-sm text-muted-foreground p-6 text-center">{t("detail.notFound")}</p>
  );
}

function ProductDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const t = useT();

  const product = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "*, brand:brands(id,name), category:categories(id,name), location:locations(id,label)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const photos = useQuery({
    queryKey: ["product-photos", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_photos")
        .select("id, storage_path, position, is_cover")
        .eq("product_id", id)
        .order("position");
      return data ?? [];
    },
  });
  const listings = useQuery({
    queryKey: ["listings", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("marketplace_listings")
        .select("*")
        .eq("product_id", id);
      return data ?? [];
    },
  });
  const history = useQuery({
    queryKey: ["history", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_status_history")
        .select("*")
        .eq("product_id", id)
        .order("changed_at", { ascending: false });
      return data ?? [];
    },
  });

  if (product.isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (product.error || !product.data)
    return <p className="text-sm text-destructive">{t("detail.notFound")}</p>;

  const p = product.data as any;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/products"><ArrowLeft className="h-4 w-4 mr-1" /> {t("common.back")}</Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            if (!confirm(t("detail.deleteConfirm"))) return;
            await supabase.from("products").delete().eq("id", id);
            toast.success(t("detail.deleted"));
            qc.invalidateQueries({ queryKey: ["products"] });
            navigate({ to: "/products" });
          }}
        >
          <Trash2 className="h-4 w-4 mr-1" /> {t("common.delete")}
        </Button>
      </div>

      <header className="space-y-3">
        <h1 className="text-2xl font-semibold break-words">{p.title || t("common.untitled")}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("common.sku")}</div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(p.sku ?? "");
                toast.success(t("detail.skuCopied"));
              }}
              className="mt-1 text-base font-semibold font-mono hover:underline"
            >
              {p.sku || "—"}
            </button>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("common.location")}</div>
            <div className="mt-1 text-base font-semibold break-words">
              {p.location?.label ?? "—"}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("common.status")}</div>
            <div className="mt-1">
              <Badge variant="secondary" className="text-sm">{tStatus(t, p.status)}</Badge>
            </div>
          </div>
        </div>
        <Button
          size="lg"
          className="h-12 w-full sm:w-auto"
          onClick={() => {
            const full = [
              p.title,
              "",
              p.description,
              "",
              `Condition: ${p.condition ?? "—"}`,
              `Price: ${formatPrice(p.price_cents, p.currency)}`,
              `SKU: ${p.sku}`,
            ].join("\n");
            navigator.clipboard.writeText(full);
            toast.success(t("detail.fullCopied"));
          }}
        >
          <Copy className="h-4 w-4 mr-2" /> {t("detail.copyFullListing")}
        </Button>
      </header>

      <PhotosSection productId={id} photos={photos.data ?? []} onChange={() => photos.refetch()} />

      <AiSuggestionPanel
        product={p}
        hasPhotos={(photos.data ?? []).length > 0}
        unsupportedCount={
          (photos.data ?? []).filter((ph) => !isAiSupportedPath(ph.storage_path)).length
        }
        onApplied={() => product.refetch()}
      />

      <CopyActions product={p} />

      <EditForm product={p} onSaved={() => product.refetch()} />

      <PublishPanel
        productId={id}
        rows={(listings.data ?? []) as any}
        onChange={() => listings.refetch()}
      />

      <ListingsSection productId={id} rows={listings.data ?? []} onChange={() => listings.refetch()} />

      <Card>
        <CardHeader><CardTitle className="text-base">{t("detail.statusHistory")}</CardTitle></CardHeader>
        <CardContent>
          {history.data?.length ? (
            <ul className="space-y-1 text-sm">
              {history.data.map((h: any) => (
                <li key={h.id} className="flex justify-between text-muted-foreground">
                  <span>
                    {h.from_status ? `${tStatus(t, h.from_status)} → ` : ""}
                    <span className="text-foreground">{tStatus(t, h.to_status)}</span>
                  </span>
                  <span className="text-xs">{new Date(h.changed_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("detail.noHistory")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PhotosSection({
  productId,
  photos,
  onChange,
}: {
  productId: string;
  photos: Array<{ id: string; storage_path: string; position: number; is_cover: boolean }>;
  onChange: () => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!photos.length) return setUrls({});
      const { data } = await supabase.storage
        .from("product-photos")
        .createSignedUrls(photos.map((p) => p.storage_path), 3600);
      if (cancelled || !data) return;
      const map: Record<string, string> = {};
      data.forEach((d, i) => { if (d.signedUrl) map[photos[i].id] = d.signedUrl; });
      setUrls(map);
    })();
    return () => { cancelled = true; };
  }, [photos]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const nextPos = (photos[photos.length - 1]?.position ?? -1) + 1;
    try {
      console.log("[product detail] preparing upload photos", files.map((f) => ({ name: f.name, type: f.type })));
      for (let i = 0; i < files.length; i++) {
        const file = await prepareImageForUpload(files[i]);
        const path = `${productId}/${crypto.randomUUID()}-${file.name}`;
        const { error } = await supabase.storage
          .from("product-photos")
          .upload(path, file, { contentType: file.type });
        if (error) throw error;
        await supabase.from("product_photos").insert({
          product_id: productId,
          storage_path: path,
          position: nextPos + i,
          is_cover: photos.length === 0 && i === 0,
        });
      }
      onChange();
    } catch (e: any) {
      console.error("[product detail] photo upload failed", e);
      toast.error(e?.message ?? getUnsupportedImageMessage());
    }
  }

  async function remove(photo: { id: string; storage_path: string }) {
    await supabase.storage.from("product-photos").remove([photo.storage_path]);
    await supabase.from("product_photos").delete().eq("id", photo.id);
    onChange();
  }

  async function setCover(photoId: string) {
    await supabase.from("product_photos").update({ is_cover: false }).eq("product_id", productId);
    await supabase.from("product_photos").update({ is_cover: true }).eq("id", photoId);
    onChange();
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= photos.length) return;
    const a = photos[index];
    const b = photos[j];
    // swap positions using a temporary out-of-range value to avoid unique conflicts if any
    await supabase.from("product_photos").update({ position: -1 }).eq("id", a.id);
    await supabase.from("product_photos").update({ position: a.position }).eq("id", b.id);
    await supabase.from("product_photos").update({ position: b.position }).eq("id", a.id);
    onChange();
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Photos</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((ph, i) => (
            <div key={ph.id} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
              {urls[ph.id] ? (
                <img src={urls[ph.id]} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full animate-pulse bg-muted" />
              )}
              {ph.is_cover && (
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  Cover
                </span>
              )}
              <div className="absolute bottom-1 right-1 flex gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded bg-black/60 p-1 text-white disabled:opacity-30"
                  aria-label="Move left"
                >
                  <ArrLeft className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === photos.length - 1}
                  className="rounded bg-black/60 p-1 text-white disabled:opacity-30"
                  aria-label="Move right"
                >
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
              <div className="absolute top-1 right-1 flex gap-1">
                {!ph.is_cover && (
                  <button
                    type="button"
                    onClick={() => setCover(ph.id)}
                    className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                  >
                    Cover
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(ph)}
                  className="rounded-full bg-black/60 p-1 text-white"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-muted-foreground hover:bg-muted/50 p-1">
            <button
              type="button"
              className="flex flex-1 flex-col items-center justify-center gap-0.5 w-full rounded hover:bg-muted/50"
              onClick={() => cameraRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              <span className="text-[10px] leading-tight">{t("common.camera")}</span>
            </button>
            <button
              type="button"
              className="flex flex-1 flex-col items-center justify-center gap-0.5 w-full rounded hover:bg-muted/50"
              onClick={() => libraryRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              <span className="text-[10px] leading-tight">{t("common.gallery")}</span>
            </button>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={onUpload}
            />
            <input
              ref={libraryRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onUpload}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyActions({ product }: { product: any }) {
  const t = useT();
  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${t("common.copied")} ${label}`);
  }
  const full = [
    product.title,
    "",
    product.description,
    "",
    `Condition: ${product.condition ?? "—"}`,
    `Price: ${formatPrice(product.price_cents, product.currency)}`,
    `SKU: ${product.sku}`,
  ].join("\n");

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("detail.quickActions")}</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => copy(product.title ?? "", t("detail.copyTitle"))}>
            <Copy className="h-3.5 w-3.5 mr-1" /> {t("detail.copyTitle")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => copy(product.description ?? "", t("detail.copyDescription"))}>
            <Copy className="h-3.5 w-3.5 mr-1" /> {t("detail.copyDescription")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => copy(full, t("detail.copyFullListing"))}>
            <Copy className="h-3.5 w-3.5 mr-1" /> {t("detail.copyFullListing")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(formatPrice(product.price_cents, product.currency), t("common.price"))}
          >
            <Copy className="h-3.5 w-3.5 mr-1" /> {t("common.price")}
          </Button>
          {MARKETPLACES.map((m) => (
            <Button key={m.id} size="sm" variant="outline" asChild>
              <a href={m.sellUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> {m.label}
              </a>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}



function EditForm({ product, onSaved }: { product: any; onSaved: () => void }) {
  const qc = useQueryClient();
  const tr = useT();
  const [title, setTitle] = useState(product.title ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [brand, setBrand] = useState(product.brand?.name ?? "");
  const [category, setCategory] = useState(product.category?.name ?? "");
  const [condition, setCondition] = useState<string>(product.condition ?? "");
  const [conditionGrade, setConditionGrade] = useState<string>(product.condition_grade ?? "");
  const [conditionNotes, setConditionNotes] = useState<string>(product.condition_notes ?? "");
  const [shippingNotes, setShippingNotes] = useState<string>(product.shipping_notes ?? "");
  const [itemSpecifics, setItemSpecifics] = useState<{ name: string; value: string }[]>(
    Array.isArray(product.item_specifics) ? product.item_specifics : [],
  );
  const [price, setPrice] = useState(
    product.price_cents != null ? (product.price_cents / 100).toFixed(2) : "",
  );
  const [locationId, setLocationId] = useState<string>(product.location_id ?? "");
  const [status, setStatus] = useState<string>(product.status);

  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: async () => (await supabase.from("locations").select("id, label").order("area")).data ?? [],
  });
  const brandList = useQuery({
    queryKey: ["brands"],
    queryFn: async () => (await supabase.from("brands").select("id, name").order("name")).data ?? [],
  });
  const categoryList = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id, name").order("name")).data ?? [],
  });

  async function ensureRow(
    table: "brands" | "categories",
    name: string,
    cache?: Array<{ id: string; name: string }>,
  ) {
    const t = name.trim();
    if (!t) return null;
    const existing = cache?.find((r) => r.name.toLowerCase() === t.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await supabase.from(table).insert({ name: t }).select("id").single();
    if (error) throw error;
    return data.id;
  }

  const save = useMutation({
    mutationFn: async () => {
      if (description.length > 900) {
        throw new Error("Description exceeds 900 characters.");
      }
      const brand_id = await ensureRow("brands", brand, brandList.data);
      const category_id = await ensureRow("categories", category, categoryList.data);
      const { error } = await supabase
        .from("products")
        .update({
          title: title.trim(),
          description: description.trim(),
          brand_id,
          category_id,
          condition: (condition || null) as any,
          price_cents: price ? Math.round(parseFloat(price) * 100) : null,
          location_id: locationId || null,
          status: status as any,
          condition_grade: conditionGrade.trim() || null,
          condition_notes: conditionNotes.trim() || null,
          shipping_notes: shippingNotes.trim() || null,
          item_specifics: itemSpecifics.filter(
            (s) => s.name.trim() && s.value.trim(),
          ) as any,
        })
        .eq("id", product.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tr("detail.saved"));
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["history", product.id] });
      onSaved();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{tr("detail.details")}</CardTitle></CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>{tr("common.title")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{tr("common.description")}</Label>
              <span className={`text-[11px] ${description.length > 900 ? "text-destructive" : "text-muted-foreground"}`}>
                {description.length} / 900
              </span>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={900}
            />
          </div>
          <div className="space-y-2">
            <Label>Item specifics</Label>
            <SpecificsList value={itemSpecifics} onChange={setItemSpecifics} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Condition grade</Label>
              <Input
                value={conditionGrade}
                placeholder="e.g. Used – Acceptable"
                onChange={(e) => setConditionGrade(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Condition notes</Label>
              <Textarea
                value={conditionNotes}
                rows={2}
                onChange={(e) => setConditionNotes(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Shipping notes</Label>
              <Textarea
                value={shippingNotes}
                rows={2}
                onChange={(e) => setShippingNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{tr("common.brand")}</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} list="brands-list-edit" />
              <datalist id="brands-list-edit">
                {brandList.data?.map((b) => <option key={b.id} value={b.name} />)}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>{tr("common.category")}</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} list="cats-list-edit" />
              <datalist id="cats-list-edit">
                {categoryList.data?.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>{tr("common.condition")}</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger><SelectValue placeholder={tr("common.select")} /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>{tCondition(tr, c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tr("common.priceUsd")}</Label>
              <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{tr("common.location")}</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder={tr("newProduct.selectLocation")} /></SelectTrigger>
                <SelectContent>
                  {locations.data?.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tr("common.status")}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{tStatus(tr, s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? tr("common.saving") : tr("detail.saveChanges")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ListingsSection({
  productId,
  rows,
  onChange,
}: {
  productId: string;
  rows: Array<any>;
  onChange: () => void;
}) {
  const t = useT();
  async function upsert(marketplace: MarketplaceId, patch: any) {
    const existing = rows.find((r) => r.marketplace === marketplace);
    if (existing) {
      await supabase.from("marketplace_listings").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("marketplace_listings").insert({
        product_id: productId,
        marketplace,
        ...patch,
      });
    }
    onChange();
  }

  async function remove(id: string) {
    await supabase.from("marketplace_listings").delete().eq("id", id);
    onChange();
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("detail.marketplaceTracking")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {MARKETPLACES.map((m) => {
          const row = rows.find((r) => r.marketplace === m.id);
          return (
            <div key={m.id} className="flex flex-col sm:flex-row gap-2 sm:items-center border rounded-md p-3">
              <div className="w-40 font-medium text-sm">{m.label}</div>
              <Select
                value={row?.status ?? "draft"}
                onValueChange={(v) => upsert(m.id, { status: v })}
              >
                <SelectTrigger className="sm:w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LISTING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{tStatus(t, s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder={t("detail.listingUrl")}
                defaultValue={row?.listing_url ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (row?.listing_url ?? "")) upsert(m.id, { listing_url: v || null });
                }}
                className="flex-1"
              />
              {row?.listing_url && (
                <Button size="sm" variant="ghost" asChild>
                  <a href={row.listing_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
              {row && (
                <Button size="sm" variant="ghost" onClick={() => remove(row.id)} aria-label="Clear">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
