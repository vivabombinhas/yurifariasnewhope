import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getUnsupportedImageMessage, prepareImageForUpload } from "@/lib/image-convert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PRODUCT_CONDITIONS,
  PRODUCT_STATUSES,
} from "@/lib/marketplaces";
import { toast } from "sonner";
import { CheckCircle2, ImagePlus, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT, tStatus, tCondition } from "@/lib/i18n";

import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/products/new")({
  head: () => ({ meta: [{ title: "New product — Inventory" }] }),
  component: NewProductPage,
  errorComponent: RouteError,
});

type SavedInfo = {
  id: string;
  sku: string;
  basic: {
    locationId: string;
    category: string;
    brand: string;
    condition: string;
  };
};

function NewProductPage() {
  const navigate = useNavigate();
  const t = useT();
  const qc = useQueryClient();
  const [photos, setPhotos] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState<string>("");
  const [price, setPrice] = useState("");
  const [locationId, setLocationId] = useState<string>("");
  const [status, setStatus] = useState<string>("received");
  const [saved, setSaved] = useState<SavedInfo | null>(null);

  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("locations")
        .select("id, label")
        .order("area");
      return data ?? [];
    },
  });
  const brandList = useQuery({
    queryKey: ["brands"],
    queryFn: async () => (await supabase.from("brands").select("id, name").order("name")).data ?? [],
  });
  const categoryList = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id, name").order("name")).data ?? [],
  });

  async function ensureBrand(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = brandList.data?.find((b) => b.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await supabase
      .from("brands")
      .insert({ name: trimmed })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }
  async function ensureCategory(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = categoryList.data?.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await supabase
      .from("categories")
      .insert({ name: trimmed })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  const create = useMutation({
    mutationFn: async () => {
      console.log("[new product] save started", { photoCount: photos.length });
      const brand_id = await ensureBrand(brand);
      const category_id = await ensureCategory(category);
      const price_cents = price ? Math.round(parseFloat(price) * 100) : null;
      const preparedPhotos = await Promise.all(photos.map((photo) => prepareImageForUpload(photo)));

      const { data: product, error } = await supabase
        .from("products")
        .insert({
          title: title.trim(),
          description: description.trim(),
          brand_id,
          category_id,
          condition: (condition || null) as any,
          price_cents,
          location_id: locationId || null,
          status: status as any,
          sku: "",
        })
        .select("id, sku")
        .single();
      if (error) throw error;

      const uploadedPaths: string[] = [];
      try {
        for (let i = 0; i < preparedPhotos.length; i++) {
          const file = preparedPhotos[i];
          const path = `${product.id}/${crypto.randomUUID()}-${file.name}`;
          const { error: upErr } = await supabase.storage
            .from("product-photos")
            .upload(path, file, { contentType: file.type });
          if (upErr) throw upErr;
          uploadedPaths.push(path);
          const { error: photoErr } = await supabase.from("product_photos").insert({
            product_id: product.id,
            storage_path: path,
            position: i,
            is_cover: i === 0,
          });
          if (photoErr) throw photoErr;
        }
      } catch (e) {
        console.error("[new product] photo upload failed; cleaning up product", e);
        if (uploadedPaths.length) await supabase.storage.from("product-photos").remove(uploadedPaths);
        await supabase.from("products").delete().eq("id", product.id);
        throw e;
      }

      return product;
    },
    onSuccess: (product) => {
      toast.success(`Created ${product.sku}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      setSaved({
        id: product.id,
        sku: product.sku,
        basic: { locationId, category, brand, condition },
      });
    },
    onError: (e: any) => toast.error(e.message ?? t("auth.failed")),
  });

  function resetForm(keep: { location?: boolean; basic?: boolean }) {
    setPhotos([]);
    setTitle("");
    setDescription("");
    setPrice("");
    setStatus("received");
    if (!keep.location && !keep.basic) {
      setLocationId("");
      setBrand("");
      setCategory("");
      setCondition("");
    } else if (keep.basic) {
      // keep location, category, brand, condition as-is
    } else if (keep.location) {
      setBrand("");
      setCategory("");
      setCondition("");
    }
    setSaved(null);
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    try {
      console.log("[new product] preparing selected photos", files.map((f) => ({ name: f.name, type: f.type })));
      const prepared = await Promise.all(files.map((file) => prepareImageForUpload(file)));
      setPhotos((cur) => [...cur, ...prepared]);
    } catch (e: any) {
      console.error("[new product] photo preparation failed", e);
      toast.error(e?.message ?? getUnsupportedImageMessage());
    }
  }
  function removePhoto(i: number) {
    setPhotos((cur) => cur.filter((_, idx) => idx !== i));
  }

  if (saved) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Card>
          <CardContent className="pt-6 space-y-4 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
            <div>
              <h2 className="text-xl font-semibold">{t("newProduct.saved")}</h2>
              <p className="text-sm text-muted-foreground">{saved.sku}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
              <Button
                size="lg"
                className="h-12 text-base"
                asChild
              >
                <Link to="/products/$id" params={{ id: saved.id }}>{t("newProduct.view")}</Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 text-base"
                onClick={() => resetForm({ location: true })}
              >
                {t("newProduct.addAnother")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 text-base"
                onClick={() => resetForm({ basic: true })}
              >
                {t("newProduct.duplicate")}
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/products" })}>
              {t("newProduct.backToProducts")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("newProduct.title")}</h1>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label className="text-base">{t("common.photos")}</Label>
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-primary hover:bg-primary/10">
            <ImagePlus className="h-6 w-6" />
            <span className="text-sm font-medium">{t("newProduct.tapToAdd")}</span>
            <span className="text-xs text-muted-foreground">{t("newProduct.cameraOrLibrary")}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={onPickFiles}
            />
          </label>
          {photos.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((file, i) => (
                <div key={i} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                  <img
                    src={URL.createObjectURL(file)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {i === 0 && (
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                      Cover
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-1.5 text-white"
                    aria-label="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="title">{t("common.title")}</Label>
          <Input id="title" className="h-12 text-base" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="desc">{t("common.description")}</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="text-base"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="brand">{t("common.brand")}</Label>
            <Input
              id="brand"
              className="h-12 text-base"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              list="brands-list"
              placeholder={t("newProduct.typeOrPick")}
            />
            <datalist id="brands-list">
              {brandList.data?.map((b) => <option key={b.id} value={b.name} />)}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">{t("common.category")}</Label>
            <Input
              id="category"
              className="h-12 text-base"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="cats-list"
              placeholder={t("newProduct.typeOrPick")}
            />
            <datalist id="cats-list">
              {categoryList.data?.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label>{t("common.condition")}</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger className="h-12 text-base"><SelectValue placeholder={t("common.select")} /></SelectTrigger>
              <SelectContent>
                {PRODUCT_CONDITIONS.map((c) => (
                  <SelectItem key={c} value={c}>{tCondition(t, c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="price">{t("common.priceUsd")}</Label>
            <Input
              id="price"
              className="h-12 text-base"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("common.location")}</Label>
            <div className="flex gap-2">
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="h-12 text-base flex-1"><SelectValue placeholder={t("newProduct.selectLocation")} /></SelectTrigger>
                <SelectContent>
                  {locations.data?.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <NewLocationDialog
                onCreated={(id) => {
                  qc.invalidateQueries({ queryKey: ["locations"] });
                  setLocationId(id);
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("common.status")}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-12 text-base"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRODUCT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{tStatus(t, s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
          <Button type="button" variant="outline" className="h-12 text-base" onClick={() => navigate({ to: "/products" })}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={create.isPending} className="h-12 text-base flex-1">
            {create.isPending ? t("common.saving") : t("newProduct.saveProduct")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function NewLocationDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState("");
  const [shelf, setShelf] = useState("");
  const [box, setBox] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!area.trim()) {
      toast.error("Area is required");
      return;
    }
    setSaving(true);
    try {
      const label = [area, shelf, box].filter((s) => s.trim()).join(" / ");
      const { data, error } = await supabase
        .from("locations")
        .insert({
          area: area.trim(),
          shelf: shelf.trim() || null,
          box: box.trim() || null,
          label,
        })
        .select("id")
        .single();
      if (error) throw error;
      onCreated(data.id);
      setOpen(false);
      setArea("");
      setShelf("");
      setBox("");
      toast.success("Location created");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="h-12 w-12" aria-label="New location">
          <Plus className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New location</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Area</Label>
            <Input className="h-12 text-base" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Garage" />
          </div>
          <div className="space-y-2">
            <Label>Shelf</Label>
            <Input className="h-12 text-base" value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder="e.g. A2" />
          </div>
          <div className="space-y-2">
            <Label>Box</Label>
            <Input className="h-12 text-base" value={box} onChange={(e) => setBox(e.target.value)} placeholder="e.g. 14" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
