import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  formatStatus,
} from "@/lib/marketplaces";
import { toast } from "sonner";
import { ImagePlus, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/products/new")({
  head: () => ({ meta: [{ title: "New product — Inventory" }] }),
  component: NewProductPage,
});

function NewProductPage() {
  const navigate = useNavigate();
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
      const brand_id = await ensureBrand(brand);
      const category_id = await ensureCategory(category);
      const price_cents = price ? Math.round(parseFloat(price) * 100) : null;

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

      // Upload photos
      for (let i = 0; i < photos.length; i++) {
        const file = photos[i];
        const path = `${product.id}/${crypto.randomUUID()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("product-photos")
          .upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        await supabase.from("product_photos").insert({
          product_id: product.id,
          storage_path: path,
          position: i,
          is_cover: i === 0,
        });
      }

      return product;
    },
    onSuccess: (product) => {
      toast.success(`Created ${product.sku}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      navigate({ to: "/products/$id", params: { id: product.id } });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create product"),
  });

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPhotos((cur) => [...cur, ...files]);
    e.target.value = "";
  }
  function removePhoto(i: number) {
    setPhotos((cur) => cur.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">New product</h1>

      <Card>
        <CardContent className="pt-6 space-y-2">
          <Label>Photos</Label>
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
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
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
                onChange={onPickFiles}
              />
            </label>
          </div>
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
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="desc">Description</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="brand">Brand</Label>
            <Input
              id="brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              list="brands-list"
              placeholder="Type or pick"
            />
            <datalist id="brands-list">
              {brandList.data?.map((b) => <option key={b.id} value={b.name} />)}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="cats-list"
              placeholder="Type or pick"
            />
            <datalist id="cats-list">
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
            <Label htmlFor="price">Price (USD)</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <div className="flex gap-2">
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select location" /></SelectTrigger>
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

        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={create.isPending} className="flex-1 sm:flex-none">
            {create.isPending ? "Saving…" : "Save product"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate({ to: "/products" })}>
            Cancel
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
        <Button type="button" variant="outline" size="icon" aria-label="New location">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New location</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Area</Label>
            <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Garage" />
          </div>
          <div className="space-y-2">
            <Label>Shelf</Label>
            <Input value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder="e.g. A2" />
          </div>
          <div className="space-y-2">
            <Label>Box</Label>
            <Input value={box} onChange={(e) => setBox(e.target.value)} placeholder="e.g. 14" />
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
