import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { analyzeProductWithAI, type AiSuggestion } from "@/lib/ai-suggestions.functions";
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
import { PRODUCT_CONDITIONS, formatStatus } from "@/lib/marketplaces";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Sparkles,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/intake")({
  head: () => ({ meta: [{ title: "Fast Intake — Inventory" }] }),
  component: IntakePage,
  errorComponent: RouteError,
});

function todayRangeISO() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function IntakePage() {
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeProductWithAI);

  const [photos, setPhotos] = useState<File[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<string>("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [verification, setVerification] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [draftProductId, setDraftProductId] = useState<string | null>(null);
  const [draftSku, setDraftSku] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: async () =>
      (await supabase.from("locations").select("id, label").order("area")).data ?? [],
  });

  const todayCount = useQuery({
    queryKey: ["intake-today-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayRangeISO());
      return count ?? 0;
    },
  });

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPhotos((cur) => [...cur, ...files]);
    e.target.value = "";
  }
  function removePhoto(i: number) {
    setPhotos((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function ensureRow(table: "brands" | "categories", name: string) {
    const t = name.trim();
    if (!t) return null;
    const { data: existing } = await supabase
      .from(table)
      .select("id")
      .ilike("name", t)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data, error } = await supabase
      .from(table)
      .insert({ name: t })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function createDraftWithPhotos(): Promise<{ id: string; sku: string }> {
    const { data: product, error } = await supabase
      .from("products")
      .insert({
        title: title.trim(),
        description: "",
        location_id: locationId || null,
        status: "received" as any,
        sku: "",
      })
      .select("id, sku")
      .single();
    if (error) throw error;

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
  }

  function applySuggestion(s: AiSuggestion) {
    if (!title) setTitle(s.title);
    if (!description) setDescription(s.description);
    if (!brand) setBrand(s.brand);
    if (!category) setCategory(s.category);
    if (!condition) setCondition(s.condition);
    if (!price && s.suggested_price_cents != null)
      setPrice((s.suggested_price_cents / 100).toFixed(2));
    setVerification(s.verification_needed ?? []);
  }

  async function runAnalyze() {
    if (photos.length === 0) {
      toast.error("Add at least one photo first.");
      return;
    }
    setAnalyzing(true);
    try {
      let id = draftProductId;
      let sku = draftSku;
      if (!id) {
        const p = await createDraftWithPhotos();
        id = p.id;
        sku = p.sku;
        setDraftProductId(id);
        setDraftSku(sku);
      }
      const s = await analyze({ data: { productId: id! } });
      applySuggestion(s);
      toast.success("AI ready — review and save.");
    } catch (e: any) {
      toast.error(e.message ?? "AI failed");
    } finally {
      setAnalyzing(false);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!photos.length && !draftProductId) {
        throw new Error("Add at least one photo.");
      }
      setSaving(true);
      const brand_id = await ensureRow("brands", brand);
      const category_id = await ensureRow("categories", category);
      const price_cents = price ? Math.round(parseFloat(price) * 100) : null;

      if (draftProductId) {
        const { error } = await supabase
          .from("products")
          .update({
            title: title.trim(),
            description: description.trim(),
            brand_id,
            category_id,
            condition: (condition || null) as any,
            price_cents,
            location_id: locationId || null,
          })
          .eq("id", draftProductId);
        if (error) throw error;
        return { id: draftProductId, sku: draftSku ?? "" };
      } else {
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
            status: "received" as any,
            sku: "",
          })
          .select("id, sku")
          .single();
        if (error) throw error;

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
      }
    },
    onSuccess: (p) => {
      toast.success(`Saved ${p.sku} — next item ready.`);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["intake-today-count"] });
      // Reset form, keep location
      setPhotos([]);
      setTitle("");
      setPrice("");
      setCondition("");
      setBrand("");
      setCategory("");
      setDescription("");
      setVerification([]);
      setShowMore(false);
      setDraftProductId(null);
      setDraftSku(null);
      setSaving(false);
    },
    onError: (e: any) => {
      setSaving(false);
      toast.error(e.message ?? "Failed to save");
    },
  });

  const canSave = photos.length > 0 || !!draftProductId;

  return (
    <div className="space-y-4 max-w-xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Zap className="h-5 w-5 text-primary" />
            Fast Intake
          </h1>
          <p className="text-xs text-muted-foreground">
            Photos → location → AI → save & next.
          </p>
        </div>
        <Card className="shrink-0">
          <CardContent className="px-4 py-2 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Today
            </p>
            <p className="text-2xl font-bold leading-none">
              {todayCount.data ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground">items</p>
          </CardContent>
        </Card>
      </div>

      {/* 1. Photos */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label className="text-base">1. Photos</Label>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-primary hover:bg-primary/10">
            <ImagePlus className="h-7 w-7" />
            <span className="text-sm font-medium">Tap to add photos</span>
            <span className="text-xs text-muted-foreground">Camera or library</span>
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={onPickFiles}
              disabled={!!draftProductId}
            />
          </label>
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((file, i) => (
                <div
                  key={i}
                  className="relative aspect-square overflow-hidden rounded-md border bg-muted"
                >
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
                  {!draftProductId && (
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-1.5 text-white"
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {draftProductId && (
            <p className="text-[11px] text-muted-foreground">
              Photos already uploaded for {draftSku}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 2. Location */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <Label className="text-base">2. Location</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {locations.data?.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!locations.data?.length && (
            <p className="text-xs text-muted-foreground">
              No locations yet —{" "}
              <Link to="/locations" className="underline">
                create one
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3. Analyze */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <Label className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> 3. Analyze with AI
            <span className="text-xs font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Button
            type="button"
            className="h-12 text-base w-full"
            onClick={runAnalyze}
            disabled={analyzing || photos.length === 0}
          >
            <Wand2 className="h-4 w-4 mr-2" />
            {analyzing ? "Analyzing…" : "Analyze with AI"}
          </Button>
          {verification.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Verify: {verification.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 4. Review */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label className="text-base">4. Review</Label>

          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              className="h-12 text-base"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="price">Price (USD)</Label>
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
              <Label>Condition</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {formatStatus(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setShowMore((v) => !v)}
          >
            {showMore ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" /> Hide advanced
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" /> Show more
              </>
            )}
          </Button>

          {showMore && (
            <div className="space-y-3 pt-1">
              <div className="space-y-2">
                <Label htmlFor="brand">Brand</Label>
                <Input
                  id="brand"
                  className="h-12 text-base"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  className="h-12 text-base"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  rows={4}
                  className="text-base"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky Save & Next */}
      <div className="fixed inset-x-0 bottom-16 md:bottom-4 z-20 px-4">
        <div className="max-w-xl mx-auto">
          <Button
            type="button"
            size="lg"
            className="h-14 text-base w-full shadow-lg"
            disabled={!canSave || saving}
            onClick={() => save.mutate()}
          >
            {saving ? "Saving…" : "Save & Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
