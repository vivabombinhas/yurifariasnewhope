import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getUnsupportedImageMessage, prepareImageForUpload } from "@/lib/image-convert";
import { withTimeout } from "@/lib/async-timeout";
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
import { PRODUCT_CONDITIONS } from "@/lib/marketplaces";
import { useT, tCondition } from "@/lib/i18n";
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
  const t = useT();

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

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    try {
      console.log("[intake] preparing selected photos", files.map((f) => ({ name: f.name, type: f.type })));
      const prepared = await Promise.all(files.map((file) => prepareImageForUpload(file)));
      setPhotos((cur) => [...cur, ...prepared]);
    } catch (e: any) {
      console.error("[intake] photo preparation failed", e);
      toast.error(e?.message ?? getUnsupportedImageMessage());
    }
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
    console.log("[intake] saving draft before AI", { photoCount: photos.length });
    const preparedPhotos = await Promise.all(photos.map((photo) => prepareImageForUpload(photo)));
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
      console.error("[intake] draft photo upload failed; cleaning up draft", e);
      if (uploadedPaths.length) await supabase.storage.from("product-photos").remove(uploadedPaths);
      await supabase.from("products").delete().eq("id", product.id);
      throw e;
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
    if (analyzing) {
      console.log("[intake] analyze ignored — already running");
      return;
    }
    if (photos.length === 0) {
      toast.error(t("intake.addPhotoFirst"));
      return;
    }
    setAnalyzing(true);
    let createdForAnalyze: { id: string; sku: string } | null = null;
    try {
      console.log("[intake] analyze clicked", { photoCount: photos.length, draftProductId });
      let id = draftProductId;
      let sku = draftSku;
      if (!id) {
        const p = await createDraftWithPhotos();
        createdForAnalyze = p;
        id = p.id;
        sku = p.sku;
        setDraftProductId(id);
        setDraftSku(sku);
      }
      console.log("[intake] starting AI analysis", { productId: id });
      const s = await withTimeout(
        analyze({ data: { productId: id! } }),
        55_000,
        "AI analysis timed out. You can still save this item manually.",
      );
      applySuggestion(s);
      toast.success(t("intake.aiReady"));
    } catch (e: any) {
      console.error("[intake] AI analysis failed", e);
      if (createdForAnalyze) {
        const { data: rows } = await supabase
          .from("product_photos")
          .select("storage_path")
          .eq("product_id", createdForAnalyze.id);
        const paths = (rows ?? []).map((row) => row.storage_path);
        if (paths.length) await supabase.storage.from("product-photos").remove(paths);
        await supabase.from("products").delete().eq("id", createdForAnalyze.id);
        setDraftProductId(null);
        setDraftSku(null);
      }
      toast.error(e?.message ?? "AI failed. You can still save this item manually.");
    } finally {
      console.log("[intake] analyze finished");
      setAnalyzing(false);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!photos.length && !draftProductId) {
        throw new Error("Add at least one photo.");
      }
      setSaving(true);
      console.log("[intake] save started", { draftProductId, photoCount: photos.length });
      const brand_id = await ensureRow("brands", brand);
      const category_id = await ensureRow("categories", category);
      const price_cents = price ? Math.round(parseFloat(price) * 100) : null;
      const preparedPhotos = draftProductId
        ? []
        : await Promise.all(photos.map((photo) => prepareImageForUpload(photo)));

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
          console.error("[intake] save photo upload failed; cleaning up product", e);
          if (uploadedPaths.length) await supabase.storage.from("product-photos").remove(uploadedPaths);
          await supabase.from("products").delete().eq("id", product.id);
          throw e;
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
            {t("intake.title")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("intake.subtitle")}
          </p>
        </div>
        <Card className="shrink-0">
          <CardContent className="px-4 py-2 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("intake.today")}
            </p>
            <p className="text-2xl font-bold leading-none">
              {todayCount.data ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground">{t("intake.items")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
        <div className="font-medium text-foreground">{t("intake.recommended")}</div>
        <div className="text-muted-foreground">{t("intake.recommendedFlow")}</div>
      </div>

      {/* 1. Photos */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label className="text-base">{t("intake.stepPhotos")}</Label>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-primary hover:bg-primary/10">
            <ImagePlus className="h-7 w-7" />
            <span className="text-sm font-medium">{t("newProduct.tapToAdd")}</span>
            <span className="text-xs text-muted-foreground">{t("newProduct.cameraOrLibrary")}</span>
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
              {t("intake.photosUploaded")} {draftSku}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 2. Location */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <Label className="text-base">{t("intake.stepLocation")}</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder={t("newProduct.selectLocation")} />
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
              {t("intake.noLocations")}{" "}
              <Link to="/locations" className="underline">
                {t("intake.createOne")}
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
            <Sparkles className="h-4 w-4 text-primary" /> {t("intake.stepAnalyze")}
            <span className="text-xs font-normal text-muted-foreground">
              {t("common.optional")}
            </span>
          </Label>
          <Button
            type="button"
            className="h-12 text-base w-full"
            onClick={runAnalyze}
            disabled={analyzing || photos.length === 0}
          >
            <Wand2 className="h-4 w-4 mr-2" />
            {analyzing ? t("intake.analyzing") : t("intake.analyze")}
          </Button>
          {verification.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("intake.verify")}: {verification.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 4. Review */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label className="text-base">{t("intake.stepReview")}</Label>

          <div className="space-y-2">
            <Label htmlFor="title">{t("common.title")}</Label>
            <Input
              id="title"
              className="h-12 text-base"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
              <Label>{t("common.condition")}</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder={t("common.select")} />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {tCondition(t, c)}
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
                <ChevronUp className="h-4 w-4 mr-1" /> {t("intake.hideAdvanced")}
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" /> {t("intake.showMore")}
              </>
            )}
          </Button>

          {showMore && (
            <div className="space-y-3 pt-1">
              <div className="space-y-2">
                <Label htmlFor="brand">{t("common.brand")}</Label>
                <Input
                  id="brand"
                  className="h-12 text-base"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">{t("common.category")}</Label>
                <Input
                  id="category"
                  className="h-12 text-base"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">{t("common.description")}</Label>
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
            {saving ? t("common.saving") : t("intake.saveNext")}
          </Button>
        </div>
      </div>
    </div>
  );
}
