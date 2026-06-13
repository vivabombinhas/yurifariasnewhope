import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  formatStatus,
  type MarketplaceId,
} from "@/lib/marketplaces";
import { toast } from "sonner";
import { ArrowLeft, ArrowLeft as ArrLeft, ArrowRight, Copy, ExternalLink, ImagePlus, Trash2, X } from "lucide-react";
import { AiSuggestionPanel } from "@/components/AiSuggestionPanel";

import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/products/$id")({
  head: () => ({ meta: [{ title: "Product — Inventory" }] }),
  component: ProductDetail,
  errorComponent: RouteError,
  notFoundComponent: () => (
    <p className="text-sm text-muted-foreground p-6 text-center">Product not found.</p>
  ),
});

function ProductDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

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

  if (product.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (product.error || !product.data)
    return <p className="text-sm text-destructive">Product not found.</p>;

  const p = product.data as any;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/products"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            if (!confirm("Delete this product and all its photos?")) return;
            await supabase.from("products").delete().eq("id", id);
            toast.success("Deleted");
            qc.invalidateQueries({ queryKey: ["products"] });
            navigate({ to: "/products" });
          }}
        >
          <Trash2 className="h-4 w-4 mr-1" /> Delete
        </Button>
      </div>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{p.title || "Untitled"}</h1>
          <Badge variant="secondary">{formatStatus(p.status)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {p.sku} · {formatPrice(p.price_cents, p.currency)}
        </p>
      </header>

      <PhotosSection productId={id} photos={photos.data ?? []} onChange={() => photos.refetch()} />

      <AiSuggestionPanel
        product={p}
        hasPhotos={(photos.data ?? []).length > 0}
        onApplied={() => product.refetch()}
      />

      <CopyActions product={p} />

      <EditForm product={p} onSaved={() => product.refetch()} />

      <ListingsSection productId={id} rows={listings.data ?? []} onChange={() => listings.refetch()} />

      <Card>
        <CardHeader><CardTitle className="text-base">Status history</CardTitle></CardHeader>
        <CardContent>
          {history.data?.length ? (
            <ul className="space-y-1 text-sm">
              {history.data.map((h: any) => (
                <li key={h.id} className="flex justify-between text-muted-foreground">
                  <span>
                    {h.from_status ? `${formatStatus(h.from_status)} → ` : ""}
                    <span className="text-foreground">{formatStatus(h.to_status)}</span>
                  </span>
                  <span className="text-xs">{new Date(h.changed_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No history.</p>
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
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
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
      toast.error(e.message);
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
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-muted-foreground hover:bg-muted/50">
            <ImagePlus className="h-5 w-5" />
            <span className="text-xs">Add</span>
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={onUpload}
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyActions({ product }: { product: any }) {
  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
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
      <CardHeader><CardTitle className="text-base">Quick actions</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => copy(product.title ?? "", "title")}>
            <Copy className="h-3.5 w-3.5 mr-1" /> Title
          </Button>
          <Button size="sm" variant="outline" onClick={() => copy(product.description ?? "", "description")}>
            <Copy className="h-3.5 w-3.5 mr-1" /> Description
          </Button>
          <Button size="sm" variant="outline" onClick={() => copy(full, "full listing")}>
            <Copy className="h-3.5 w-3.5 mr-1" /> Full listing
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(formatPrice(product.price_cents, product.currency), "price")}
          >
            <Copy className="h-3.5 w-3.5 mr-1" /> Price
          </Button>
          {MARKETPLACES.map((m) => (
            <Button key={m.id} size="sm" variant="outline" asChild>
              <a href={m.sellUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open {m.label}
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
  const [title, setTitle] = useState(product.title ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [brand, setBrand] = useState(product.brand?.name ?? "");
  const [category, setCategory] = useState(product.category?.name ?? "");
  const [condition, setCondition] = useState<string>(product.condition ?? "");
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
        })
        .eq("id", product.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["history", product.id] });
      onSaved();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Brand</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} list="brands-list-edit" />
              <datalist id="brands-list-edit">
                {brandList.data?.map((b) => <option key={b.id} value={b.name} />)}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} list="cats-list-edit" />
              <datalist id="cats-list-edit">
                {categoryList.data?.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>Condition</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>{formatStatus(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Price (USD)</Label>
              <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.data?.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{formatStatus(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
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
      <CardHeader><CardTitle className="text-base">Marketplace tracking</CardTitle></CardHeader>
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
                    <SelectItem key={s} value={s}>{formatStatus(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Listing URL"
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
