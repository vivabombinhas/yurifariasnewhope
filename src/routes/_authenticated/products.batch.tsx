import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ImagePlus, Loader2, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { prepareImageForUpload, getUnsupportedImageMessage } from "@/lib/image-convert";
import { runWithConcurrency } from "@/lib/concurrency";
import { groupPhotosBySimilarity } from "@/lib/batch-grouping.functions";
import { analyzeProductWithAI, type AiSuggestion } from "@/lib/ai-suggestions.functions";
import {
  analyzeProductV2,
  type MarketplaceDraftV2,
  type VerificationQuestionV2,
} from "@/lib/ai-listing-v2.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRODUCT_CONDITIONS } from "@/lib/marketplaces";
import { tCondition, useT } from "@/lib/i18n";
import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/products/batch")({
  head: () => ({ meta: [{ title: "Batch intake — Inventory" }] }),
  component: BatchIntakePage,
  errorComponent: RouteError,
});

type StagedPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  storagePath: string | null; // null = not uploaded yet
  uploading: boolean;
};

type DraftStatus = "pending" | "uploading" | "analyzing" | "ready" | "error";

type ItemSpecific = { name: string; value: string };

type BatchDraft = {
  id: string; // local id
  photoIds: string[];
  productId: string | null;
  sku: string | null;
  status: DraftStatus;
  errorMessage?: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  condition: string;
  price: string; // dollars
  condition_grade: string;
  condition_notes: string;
  shipping_notes: string;
  item_specifics: ItemSpecific[];
  aiAnalysisId: string | null;
  aiVersion: 1 | 2;
  verificationQuestions: VerificationQuestionV2[];
  verificationAnswers: Record<string, string>;
  marketplaceDrafts: MarketplaceDraftV2[];
  qualityFlags: string[];
};

function rid() {
  return crypto.randomUUID();
}

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i) : "";
}

function BatchIntakePage() {
  const t = useT();
  const navigate = useNavigate();
  const groupFn = useServerFn(groupPhotosBySimilarity);
  const analyzeFn = useServerFn(analyzeProductWithAI);
  const analyzeV2Fn = useServerFn(analyzeProductV2);

  const sessionId = useMemo(() => rid(), []);
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [drafts, setDrafts] = useState<BatchDraft[]>([]);
  const [grouping, setGrouping] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const allUploaded = photos.length > 0 && photos.every((p) => p.storagePath);
  const hasDrafts = drafts.length > 0;
  const allReadyOrError = drafts.every((d) => d.status === "ready" || d.status === "error");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    let prepared: File[];
    try {
      prepared = await Promise.all(files.map((f) => prepareImageForUpload(f)));
    } catch (err: any) {
      toast.error(err?.message ?? getUnsupportedImageMessage());
      return;
    }
    const newOnes: StagedPhoto[] = prepared.map((file) => ({
      id: rid(),
      file,
      previewUrl: URL.createObjectURL(file),
      storagePath: null,
      uploading: true,
    }));
    setPhotos((cur) => [...cur, ...newOnes]);

    // Upload to staging in parallel (limit 4)
    await runWithConcurrency(
      newOnes,
      4,
      async (p) => {
        const path = `staging/${sessionId}/${p.id}${extOf(p.file.name)}`;
        const { error } = await supabase.storage
          .from("product-photos")
          .upload(path, p.file, { contentType: p.file.type });
        if (error) throw error;
        setPhotos((cur) =>
          cur.map((x) => (x.id === p.id ? { ...x, storagePath: path, uploading: false } : x)),
        );
      },
      (_i, _v, err) => {
        if (err) {
          toast.error(`Upload failed: ${(err as any)?.message ?? err}`);
        }
      },
    );
  }

  function removePhoto(id: string) {
    const p = photos.find((x) => x.id === id);
    setPhotos((cur) => cur.filter((x) => x.id !== id));
    setDrafts((cur) =>
      cur
        .map((d) => ({ ...d, photoIds: d.photoIds.filter((pid) => pid !== id) }))
        .filter((d) => d.photoIds.length > 0),
    );
    if (p?.storagePath) {
      supabase.storage
        .from("product-photos")
        .remove([p.storagePath])
        .catch(() => {});
    }
    URL.revokeObjectURL(p?.previewUrl ?? "");
  }

  async function runGrouping() {
    if (!allUploaded) {
      toast.error("Wait for uploads to finish.");
      return;
    }
    if (photos.length < 2) {
      // Single product: make one group
      setDrafts([newDraftFromPhotoIds(photos.map((p) => p.id))]);
      return;
    }
    setGrouping(true);
    try {
      const paths = photos.map((p) => p.storagePath!);
      const result = await groupFn({ data: { storagePaths: paths } });
      const built: BatchDraft[] = result.groups.map((groupIdxs) =>
        newDraftFromPhotoIds(groupIdxs.map((i) => photos[i].id)),
      );
      setDrafts(built);
      toast.success(`Grouped into ${built.length} product(s).`);
    } catch (e: any) {
      toast.error(e?.message ?? "Grouping failed.");
    } finally {
      setGrouping(false);
    }
  }

  function newDraftFromPhotoIds(ids: string[]): BatchDraft {
    return {
      id: rid(),
      photoIds: ids,
      productId: null,
      sku: null,
      status: "pending",
      title: "",
      description: "",
      brand: "",
      category: "",
      condition: "",
      price: "",
      condition_grade: "",
      condition_notes: "",
      shipping_notes: "",
      item_specifics: [],
      aiAnalysisId: null,
      aiVersion: 2,
      verificationQuestions: [],
      verificationAnswers: {},
      marketplaceDrafts: [],
      qualityFlags: [],
    };
  }

  function splitDraft(draftId: string, photoId: string) {
    setDrafts((cur) => {
      const target = cur.find((d) => d.id === draftId);
      if (!target || target.photoIds.length <= 1) return cur;
      const remaining = target.photoIds.filter((p) => p !== photoId);
      const fresh = newDraftFromPhotoIds([photoId]);
      return cur.map((d) => (d.id === draftId ? { ...d, photoIds: remaining } : d)).concat(fresh);
    });
  }

  function movePhoto(photoId: string, toDraftId: string) {
    setDrafts((cur) =>
      cur
        .map((d) => {
          if (d.id === toDraftId) {
            if (d.photoIds.includes(photoId)) return d;
            return { ...d, photoIds: [...d.photoIds, photoId] };
          }
          return { ...d, photoIds: d.photoIds.filter((p) => p !== photoId) };
        })
        .filter((d) => d.photoIds.length > 0),
    );
  }

  function deleteDraft(draftId: string) {
    setDrafts((cur) => cur.filter((d) => d.id !== draftId));
  }

  async function materializeAndAnalyze(draft: BatchDraft): Promise<void> {
    // 1. Insert product row
    setDrafts((cur) => cur.map((d) => (d.id === draft.id ? { ...d, status: "uploading" } : d)));
    const { data: product, error: insErr } = await supabase
      .from("products")
      .insert({
        title: "",
        description: "",
        status: "received" as any,
        sku: "",
      })
      .select("id, sku")
      .single();
    if (insErr) throw new Error(`Create product: ${insErr.message}`);

    // 2. Move staging photos to product folder
    const groupPhotos = draft.photoIds
      .map((pid) => photos.find((p) => p.id === pid))
      .filter((p): p is StagedPhoto => !!p && !!p.storagePath);

    const finalPaths: string[] = [];
    for (let i = 0; i < groupPhotos.length; i++) {
      const sp = groupPhotos[i];
      const fromPath = sp.storagePath!;
      const fname = fromPath.split("/").pop()!;
      const toPath = `${product.id}/${fname}`;
      const { error: mvErr } = await supabase.storage.from("product-photos").move(fromPath, toPath);
      if (mvErr) throw new Error(`Move photo: ${mvErr.message}`);
      finalPaths.push(toPath);
      const { error: phErr } = await supabase.from("product_photos").insert({
        product_id: product.id,
        storage_path: toPath,
        position: i,
        is_cover: i === 0,
      });
      if (phErr) throw new Error(`Photo row: ${phErr.message}`);
    }

    setDrafts((cur) =>
      cur.map((d) =>
        d.id === draft.id
          ? { ...d, productId: product.id, sku: product.sku, status: "analyzing" }
          : d,
      ),
    );

    // 3. Analyze with AI v2. If the additive v2 tables are not deployed yet,
    // preserve the existing batch workflow through the proven v1 fallback.
    let s: AiSuggestion;
    let v2: Awaited<ReturnType<typeof analyzeV2Fn>> | null = null;
    try {
      v2 = await analyzeV2Fn({ data: { productId: product.id } });
      const ebay = v2.marketplace_drafts.find((draft) => draft.marketplace === "ebay");
      s = {
        title: ebay?.title ?? v2.identification.product_name,
        description: ebay?.description ?? "",
        brand: v2.identification.brand,
        category: v2.identification.category,
        condition: v2.identification.condition,
        tags: ebay?.keywords ?? [],
        suggested_price_cents: ebay?.listing_price_cents ?? null,
        confidence_notes: v2.quality_flags.join(" "),
        verification_needed: v2.verification_questions.map((q) => q.prompt),
        item_specifics: v2.identification.item_specifics,
        condition_grade: v2.identification.condition_grade,
        condition_notes: v2.identification.condition_notes,
        shipping_notes: ebay?.shipping_text ?? "",
        possible_brand: "",
        possible_model: v2.identification.model,
        visual_clues: v2.identification.confirmed_facts,
        search_keywords: ebay?.keywords ?? [],
        recommended_research_queries: [],
        price_confidence:
          ebay?.price_confidence === "research_required"
            ? "manual_required"
            : ((ebay?.price_confidence ?? "low") as AiSuggestion["price_confidence"]),
        potentially_valuable: v2.identification.potentially_valuable,
      };
    } catch (v2Error) {
      console.warn("[batch] AI v2 unavailable; falling back to v1", v2Error);
      s = await analyzeFn({ data: { productId: product.id } });
    }
    setDrafts((cur) =>
      cur.map((d) =>
        d.id === draft.id
          ? {
              ...d,
              status: "ready",
              title: s.title ?? "",
              description: s.description ?? "",
              brand: s.brand ?? "",
              category: s.category ?? "",
              condition: s.condition ?? "",
              price:
                s.suggested_price_cents != null ? (s.suggested_price_cents / 100).toFixed(2) : "",
              condition_grade: s.condition_grade ?? "",
              condition_notes: s.condition_notes ?? "",
              shipping_notes: s.shipping_notes ?? "",
              item_specifics: Array.isArray(s.item_specifics) ? s.item_specifics : [],
              aiAnalysisId: v2?.analysisId ?? null,
              aiVersion: v2 ? 2 : 1,
              verificationQuestions: v2?.verification_questions ?? [],
              verificationAnswers: {},
              marketplaceDrafts: v2?.marketplace_drafts ?? [],
              qualityFlags: v2?.quality_flags ?? [],
            }
          : d,
      ),
    );
  }

  async function runAnalyzeAll() {
    const pending = drafts.filter((d) => d.status === "pending");
    if (!pending.length) return;
    setAnalyzing(true);
    try {
      await runWithConcurrency(pending, 3, async (d) => {
        try {
          await materializeAndAnalyze(d);
        } catch (e: any) {
          setDrafts((cur) =>
            cur.map((x) =>
              x.id === d.id ? { ...x, status: "error", errorMessage: e?.message ?? "Failed" } : x,
            ),
          );
        }
      });
      toast.success("Batch analysis complete.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function ensureBrand(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const { data: existing } = await supabase
      .from("brands")
      .select("id")
      .ilike("name", trimmed)
      .maybeSingle();
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
    const { data: existing } = await supabase
      .from("categories")
      .select("id")
      .ilike("name", trimmed)
      .maybeSingle();
    if (existing) return existing.id;
    const { data, error } = await supabase
      .from("categories")
      .insert({ name: trimmed })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function saveAll() {
    const toSave = drafts.filter((d) => d.status === "ready" && d.productId);
    if (!toSave.length) {
      toast.error("No drafts ready to save.");
      return;
    }
    setSavingAll(true);
    try {
      const results = await runWithConcurrency(toSave, 4, async (d) => {
        const brand_id = await ensureBrand(d.brand);
        const category_id = await ensureCategory(d.category);
        const price_cents = d.price ? Math.round(parseFloat(d.price) * 100) : null;
        const cleanSpecs = (d.item_specifics || [])
          .map((s) => ({ name: (s.name || "").trim(), value: (s.value || "").trim() }))
          .filter((s) => s.name && s.value);
        const { error } = await supabase
          .from("products")
          .update({
            title: d.title.trim(),
            description: d.description.trim(),
            brand_id,
            category_id,
            condition: (d.condition || null) as any,
            price_cents,
            status: "draft" as any,
            condition_grade: d.condition_grade.trim() || null,
            condition_notes: d.condition_notes.trim() || null,
            shipping_notes: d.shipping_notes.trim() || null,
            item_specifics: cleanSpecs as any,
          })
          .eq("id", d.productId!);
        if (error) throw error;
        if (d.aiAnalysisId) {
          const requiredKeys = d.verificationQuestions.filter((q) => q.required).map((q) => q.key);
          const reviewComplete = requiredKeys.every((key) => !!d.verificationAnswers[key]);
          const { error: reviewError } = await (supabase as any)
            .from("ai_product_analyses")
            .update({
              verification_answers: d.verificationAnswers,
              status: reviewComplete ? "approved" : "needs_review",
            })
            .eq("id", d.aiAnalysisId);
          if (reviewError) throw reviewError;
        }
      });
      const failed = results.filter((r) => !r.ok).length;
      if (failed) toast.error(`${failed} draft(s) failed to save.`);
      else toast.success(`Saved ${toSave.length} product(s).`);
      navigate({ to: "/products" });
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/products">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Batch intake</h1>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label className="text-base">1. Upload all photos (mix of multiple products is OK)</Label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex min-h-24 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-primary hover:bg-primary/10"
          >
            <ImagePlus className="h-6 w-6" />
            <span className="text-sm font-medium">Add photos</span>
            <span className="text-xs text-muted-foreground">
              Camera or gallery — pick many at once
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onPick}
          />
          {photos.length > 0 && (
            <>
              <div className="text-xs text-muted-foreground">
                {photos.length} photo(s) · {photos.filter((p) => p.storagePath).length} uploaded
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {photos.map((p) => (
                  <div
                    key={p.id}
                    className="relative aspect-square overflow-hidden rounded-md border bg-muted"
                  >
                    <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                    {p.uploading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Loader2 className="h-4 w-4 animate-spin text-white" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(p.id)}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
                      aria-label="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            2. Group photos by product (AI)
          </Label>
          <Button
            type="button"
            className="h-11 w-full"
            onClick={runGrouping}
            disabled={!allUploaded || grouping || hasDrafts}
          >
            {grouping ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Grouping…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                Group {photos.length || ""} photos with AI
              </>
            )}
          </Button>
          {hasDrafts && (
            <p className="text-[11px] text-muted-foreground">
              {drafts.length} group(s) created. Adjust below if needed, then analyze.
            </p>
          )}
        </CardContent>
      </Card>

      {hasDrafts && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                3. Analyze all with AI (3 in parallel)
              </Label>
              <Button
                type="button"
                onClick={runAnalyzeAll}
                disabled={analyzing || drafts.every((d) => d.status !== "pending")}
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 mr-2" />
                    Analyze {drafts.filter((d) => d.status === "pending").length} pending
                  </>
                )}
              </Button>
            </div>

            <div className="space-y-3">
              {drafts.map((d, idx) => (
                <DraftCard
                  key={d.id}
                  draft={d}
                  index={idx}
                  photos={photos}
                  allDrafts={drafts}
                  onUpdate={(patch) =>
                    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, ...patch } : x)))
                  }
                  onSplit={(photoId) => splitDraft(d.id, photoId)}
                  onMove={movePhoto}
                  onDelete={() => deleteDraft(d.id)}
                  t={t}
                />
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate({ to: "/products" })}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={saveAll}
                disabled={
                  savingAll ||
                  !allReadyOrError ||
                  drafts.filter((d) => d.status === "ready").length === 0 ||
                  drafts.some(
                    (d) =>
                      d.status === "ready" &&
                      d.verificationQuestions.some(
                        (q) => q.required && !d.verificationAnswers[q.key],
                      ),
                  )
                }
              >
                {savingAll ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
                  </>
                ) : (
                  <>Save {drafts.filter((d) => d.status === "ready").length} draft(s)</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function statusVariant(s: DraftStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "ready":
      return "default";
    case "error":
      return "destructive";
    case "analyzing":
    case "uploading":
      return "secondary";
    default:
      return "outline";
  }
}

function DraftCard({
  draft,
  index,
  photos,
  allDrafts,
  onUpdate,
  onSplit,
  onMove,
  onDelete,
  t,
}: {
  draft: BatchDraft;
  index: number;
  photos: StagedPhoto[];
  allDrafts: BatchDraft[];
  onUpdate: (patch: Partial<BatchDraft>) => void;
  onSplit: (photoId: string) => void;
  onMove: (photoId: string, toDraftId: string) => void;
  onDelete: () => void;
  t: ReturnType<typeof useT>;
}) {
  const groupPhotos = draft.photoIds
    .map((pid) => photos.find((p) => p.id === pid))
    .filter((p): p is StagedPhoto => !!p);
  const otherDrafts = allDrafts.filter((d) => d.id !== draft.id);
  const isEditable = draft.status === "ready" || draft.status === "pending";
  const isLocked = draft.status === "uploading" || draft.status === "analyzing";

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Product #{index + 1}</span>
          {draft.sku && <span className="text-xs text-muted-foreground">{draft.sku}</span>}
          <Badge variant={statusVariant(draft.status)} className="capitalize">
            {draft.status}
          </Badge>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={isLocked}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {draft.errorMessage && <p className="text-xs text-destructive">{draft.errorMessage}</p>}

      {draft.status === "ready" && draft.aiVersion === 2 && (
        <div className="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>AI v2</Badge>
            {draft.verificationQuestions.length === 0 ? (
              <span className="text-xs text-emerald-700">Ready for review</span>
            ) : (
              <span className="text-xs font-medium">
                Confirm{" "}
                {
                  draft.verificationQuestions.filter(
                    (q) => q.required && !draft.verificationAnswers[q.key],
                  ).length
                }{" "}
                required detail(s)
              </span>
            )}
          </div>
          {draft.verificationQuestions.map((question) => (
            <div key={question.key} className="space-y-1.5 rounded-md bg-background p-2">
              <p className="text-sm font-medium">{question.prompt}</p>
              {question.reason && (
                <p className="text-[11px] text-muted-foreground">{question.reason}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {question.options.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={
                      draft.verificationAnswers[question.key] === option ? "default" : "outline"
                    }
                    className="h-8"
                    onClick={() =>
                      onUpdate({
                        verificationAnswers: {
                          ...draft.verificationAnswers,
                          [question.key]: option,
                        },
                      })
                    }
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {draft.qualityFlags.length > 0 && (
            <p className="text-xs text-amber-700">Check: {draft.qualityFlags.join(" · ")}</p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {draft.marketplaceDrafts.map((listing) => (
              <div key={listing.marketplace} className="rounded-md border bg-background p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold capitalize">{listing.marketplace}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {listing.price_confidence.replaceAll("_", " ")}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs">{listing.title}</p>
                <p className="mt-1 text-sm font-semibold">
                  {listing.listing_price_cents == null
                    ? "Research price"
                    : `$${(listing.listing_price_cents / 100).toFixed(2)}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {groupPhotos.map((p) => (
          <div key={p.id} className="relative group">
            <img src={p.previewUrl} alt="" className="h-16 w-16 rounded-md border object-cover" />
            {!isLocked && (
              <div className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/60 rounded-md gap-1">
                {groupPhotos.length > 1 && draft.status === "pending" && (
                  <button
                    type="button"
                    className="text-[10px] text-white px-1.5 py-0.5 bg-white/20 rounded"
                    onClick={() => onSplit(p.id)}
                  >
                    Split
                  </button>
                )}
                {otherDrafts.length > 0 && draft.status === "pending" && (
                  <Select onValueChange={(val) => onMove(p.id, val)}>
                    <SelectTrigger className="h-6 w-16 text-[10px]">
                      <SelectValue placeholder="Move" />
                    </SelectTrigger>
                    <SelectContent>
                      {otherDrafts.map((od, i) => (
                        <SelectItem key={od.id} value={od.id}>
                          #{allDrafts.indexOf(od) + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {(draft.status === "ready" || draft.status === "pending") && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Title</Label>
            <Input
              value={draft.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              disabled={!isEditable}
            />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              rows={3}
              value={draft.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              disabled={!isEditable}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Brand</Label>
            <Input
              value={draft.brand}
              onChange={(e) => onUpdate({ brand: e.target.value })}
              disabled={!isEditable}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Input
              value={draft.category}
              onChange={(e) => onUpdate({ category: e.target.value })}
              disabled={!isEditable}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Condition</Label>
            <Select
              value={draft.condition}
              onValueChange={(v) => onUpdate({ condition: v })}
              disabled={!isEditable}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
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
          <div className="space-y-1">
            <Label className="text-xs">Price (USD)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={draft.price}
              onChange={(e) => onUpdate({ price: e.target.value })}
              disabled={!isEditable}
            />
          </div>

          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Condition grade</Label>
            <Input
              value={draft.condition_grade}
              onChange={(e) => onUpdate({ condition_grade: e.target.value })}
              disabled={!isEditable}
              placeholder='e.g. "Used – Very Good"'
            />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Condition notes</Label>
            <Textarea
              rows={2}
              value={draft.condition_notes}
              onChange={(e) => onUpdate({ condition_notes: e.target.value })}
              disabled={!isEditable}
              placeholder="Visible flaws, locations, wear…"
            />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Shipping notes</Label>
            <Textarea
              rows={2}
              value={draft.shipping_notes}
              onChange={(e) => onUpdate({ shipping_notes: e.target.value })}
              disabled={!isEditable}
              placeholder="Packaging plan, handling…"
            />
          </div>

          <div className="sm:col-span-2 space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Item specifics ({draft.item_specifics.length})</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!isEditable}
                onClick={() =>
                  onUpdate({
                    item_specifics: [...draft.item_specifics, { name: "", value: "" }],
                  })
                }
              >
                + Add
              </Button>
            </div>
            <div className="space-y-1">
              {draft.item_specifics.map((sp, i) => (
                <div key={i} className="flex gap-1">
                  <Input
                    className="h-8 text-xs flex-1"
                    placeholder="Name"
                    value={sp.name}
                    disabled={!isEditable}
                    onChange={(e) => {
                      const next = [...draft.item_specifics];
                      next[i] = { ...next[i], name: e.target.value };
                      onUpdate({ item_specifics: next });
                    }}
                  />
                  <Input
                    className="h-8 text-xs flex-1"
                    placeholder="Value"
                    value={sp.value}
                    disabled={!isEditable}
                    onChange={(e) => {
                      const next = [...draft.item_specifics];
                      next[i] = { ...next[i], value: e.target.value };
                      onUpdate({ item_specifics: next });
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    disabled={!isEditable}
                    onClick={() =>
                      onUpdate({
                        item_specifics: draft.item_specifics.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {draft.item_specifics.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No specifics yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
