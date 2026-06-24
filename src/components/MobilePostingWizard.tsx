import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Share2,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import {
  getAssistedListing,
  markAssistedPublished,
  saveMobileProgress,
} from "@/lib/marketplaces/assisted.functions";
import { canShareFiles, copyText, readClipboardText } from "@/lib/clipboard";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketplace: MarketplaceId;
  productId: string;
  onSaved?: () => void;
}

// Per-platform field order used by the wizard's "Copy next" loop.
const FIELD_ORDER: Record<MarketplaceId, string[]> = {
  facebook_marketplace: ["title", "price", "description", "brand", "size", "color"],
  poshmark: [
    "title",
    "description",
    "brand",
    "category",
    "size",
    "color",
    "condition",
    "price",
  ],
  depop: [
    "title",
    "description",
    "brand",
    "category",
    "size",
    "color",
    "condition",
    "price",
    "style",
  ],
  ebay: [],
  etsy: [],
};

// Strict allow-list of accepted listing-URL hosts per marketplace.
const ALLOWED_HOSTS: Record<MarketplaceId, string[]> = {
  facebook_marketplace: ["facebook.com", "www.facebook.com", "m.facebook.com"],
  poshmark: ["poshmark.com", "www.poshmark.com"],
  depop: ["depop.com", "www.depop.com"],
  ebay: [],
  etsy: [],
};

const STEP_LABELS = [
  "Review",
  "Photos",
  "Copy fields",
  "Open marketplace",
  "Checklist",
  "Register URL",
];

type Progress = {
  currentStep?: number;
  copiedFields?: string[];
  photosPrepared?: boolean;
  marketplaceOpened?: boolean;
  checklist?: Record<string, boolean>;
  updatedAt?: string;
};

export function MobilePostingWizard({
  open,
  onOpenChange,
  marketplace,
  productId,
  onSaved,
}: Props) {
  const qc = useQueryClient();
  const meta = MARKETPLACES.find((m) => m.id === marketplace)!;
  const getFn = useServerFn(getAssistedListing);
  const saveFn = useServerFn(saveMobileProgress);
  const publishFn = useServerFn(markAssistedPublished);

  const queryKey = ["assisted-listing", marketplace, productId];
  const q = useQuery({
    queryKey,
    queryFn: () => getFn({ data: { productId, marketplace } }),
    enabled: open,
    staleTime: 10_000,
  });

  const storageKey = `mpw:progress:${marketplace}:${productId}`;

  // Read any locally-cached progress synchronously so the wizard hydrates
  // instantly even if the server query is still loading or offline.
  const localProgress: Progress = useMemo(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Progress) : {};
    } catch {
      return {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, open]);

  const serverProgress: Progress = useMemo(() => {
    const pm = (q.data?.listing?.provider_metadata as any) ?? {};
    return (pm.mobilePostingProgress as Progress) ?? {};
  }, [q.data]);

  // Merge: prefer the most recently updated source, field-by-field fall back.
  const initialProgress: Progress = useMemo(() => {
    const ls = localProgress.updatedAt ? Date.parse(localProgress.updatedAt) : 0;
    const ss = serverProgress.updatedAt ? Date.parse(serverProgress.updatedAt) : 0;
    const primary = ls >= ss ? localProgress : serverProgress;
    const secondary = ls >= ss ? serverProgress : localProgress;
    return { ...secondary, ...primary };
  }, [localProgress, serverProgress]);

  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState<string[]>([]);
  const [photosPrepared, setPhotosPrepared] = useState(false);
  const [marketplaceOpened, setMarketplaceOpened] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [urlInput, setUrlInput] = useState("");
  const [fallback, setFallback] = useState<{ label: string; text: string } | null>(
    null,
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const hydrated = useRef(false);
  // Accumulates the live state so we can always flush the latest snapshot,
  // even if a debounced save is mid-flight when the user backgrounds the app.
  const latestRef = useRef<Progress>({});

  // Hydrate once per open from the merged local+server snapshot.
  useEffect(() => {
    if (!open) {
      hydrated.current = false;
      return;
    }
    // We can hydrate from localStorage even before the server query resolves.
    if (hydrated.current) return;
    if (!q.data && !localProgress.updatedAt) return;
    hydrated.current = true;
    const init = initialProgress;
    setStep(init.currentStep ?? 0);
    setCopied(init.copiedFields ?? []);
    setPhotosPrepared(init.photosPrepared ?? false);
    setMarketplaceOpened(init.marketplaceOpened ?? false);
    setChecklist(init.checklist ?? {});
    latestRef.current = { ...init };
  }, [open, q.data, initialProgress, localProgress.updatedAt]);

  // Debounced save with localStorage write-through and serialized in-flight
  // writes. Local storage is the source of truth across reloads; the server
  // is best-effort and retried on failure.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const pendingPatch = useRef<Progress>({});

  const writeLocal = (next: Progress) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* quota / private mode — ignore */
    }
  };

  const flushNow = async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const patch = pendingPatch.current;
    if (!patch || Object.keys(patch).length === 0) return;
    pendingPatch.current = {};
    const attempt = async (tries: number): Promise<void> => {
      try {
        if (inFlight.current) await inFlight.current.catch(() => {});
        const p = saveFn({ data: { productId, marketplace, progress: patch } });
        inFlight.current = p;
        await p;
      } catch (e) {
        console.warn("[wizard] save failed", e);
        if (tries > 0) {
          await new Promise((r) => setTimeout(r, 600));
          return attempt(tries - 1);
        }
      } finally {
        inFlight.current = null;
      }
    };
    await attempt(2);
  };

  const persist = async (patch: Partial<Progress>, immediate = false) => {
    if (!open || !hydrated.current) return;
    const now = new Date().toISOString();
    const merged: Progress = { ...latestRef.current, ...patch, updatedAt: now };
    latestRef.current = merged;
    pendingPatch.current = { ...pendingPatch.current, ...patch, updatedAt: now };
    // Always mirror to localStorage immediately — survives crash/close/offline.
    writeLocal(merged);
    if (immediate) {
      await flushNow();
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushNow();
    }, 400);
  };

  // Flush pending writes on close, tab hide, navigation, or app background.
  // Mobile browsers often skip 'beforeunload'; pagehide + visibilitychange
  // are the reliable signals.
  useEffect(() => {
    if (!open) return;
    const handler = () => {
      if (document.visibilityState === "hidden") void flushNow();
    };
    const onPageHide = () => void flushNow();
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("pagehide", onPageHide);
      void flushNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);


  const publish = useMutation({
    mutationFn: (listingUrl: string) =>
      publishFn({ data: { productId, marketplace, listingUrl } }),
    onSuccess: () => {
      toast.success("Marked as published");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["assisted-listing-status", marketplace, productId] });
      onSaved?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) return null;

  const fields = q.data?.payload.fields ?? [];
  const order = FIELD_ORDER[marketplace];
  const orderedFields = order
    .map((key) => fields.find((f: any) => f.key === key))
    .filter((f): f is any => Boolean(f && f.value));

  const nextField = orderedFields.find((f) => !copied.includes(f.key)) ?? null;

  const handleCopy = async (key: string, label: string, value: string | null) => {
    if (!value) return;
    try {
      await copyText(value);
      const nextCopied = copied.includes(key) ? copied : [...copied, key];
      setCopied(nextCopied);
      toast.success(`${label} copied`);
      void persist({ copiedFields: nextCopied });
    } catch {
      setFallback({ label, text: value });
    }
  };

  const handleStep = (next: number) => {
    setStep(next);
    void persist({ currentStep: next, copiedFields: copied }, true);
  };

  const handleOpenMarketplace = async () => {
    setMarketplaceOpened(true);
    await persist({ marketplaceOpened: true, currentStep: Math.max(step, 4) }, true);
    window.open(meta.sellUrl, "_blank", "noopener,noreferrer");
    if (step < 4) setStep(4);
  };

  const toggleChecklist = (k: string) => {
    const next = { ...checklist, [k]: !checklist[k] };
    setChecklist(next);
    void persist({ checklist: next }, true);
  };


  const validateUrl = (raw: string): { ok: true; url: string } | { ok: false; reason: string } => {
    try {
      const u = new URL(raw.trim());
      if (u.protocol !== "https:") return { ok: false, reason: "URL must use HTTPS" };
      const allowed = ALLOWED_HOSTS[marketplace];
      if (!allowed.includes(u.hostname.toLowerCase()))
        return {
          ok: false,
          reason: `URL host must be one of: ${allowed.join(", ")}`,
        };
      return { ok: true, url: u.toString() };
    } catch {
      return { ok: false, reason: "Invalid URL" };
    }
  };

  const handlePublish = () => {
    const v = validateUrl(urlInput);
    if (!v.ok) {
      toast.error(v.reason);
      return;
    }
    publish.mutate(v.url);
  };

  const handlePaste = async () => {
    const t = await readClipboardText();
    if (t) setUrlInput(t.trim());
    else toast.error("Clipboard not available");
  };

  const resetProgress = async () => {
    setConfirmReset(false);
    try {
      await saveFn({ data: { productId, marketplace, progress: {}, reset: true } });
      setStep(0);
      setCopied([]);
      setPhotosPrepared(false);
      setMarketplaceOpened(false);
      setChecklist({});
      toast.success("Posting progress reset");
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="flex h-[100dvh] w-full flex-col gap-0 p-0 sm:max-w-lg sm:mx-auto sm:h-[90dvh] sm:rounded-t-xl"
        >
          <SheetTitle className="sr-only">Mobile posting wizard</SheetTitle>
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{meta.label}</div>
              <div className="truncate text-sm font-semibold">
                Step {step + 1} of {STEP_LABELS.length}: {STEP_LABELS[step]}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setConfirmReset(true)}
                aria-label="Reset progress"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Progress
            value={((step + 1) / STEP_LABELS.length) * 100}
            className="h-1 rounded-none"
          />

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {q.isLoading || !q.data ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                {step === 0 && (
                  <StepReview
                    data={q.data}
                    onContinue={() => handleStep(1)}
                  />
                )}
                {step === 1 && (
                  <StepPhotos
                    photos={q.data.photos}
                    productSku={(q.data as any).payload.title}
                    onPrepared={() => {
                      setPhotosPrepared(true);
                      void persist({ photosPrepared: true }, true);
                    }}
                    prepared={photosPrepared}
                  />
                )}
                {step === 2 && (
                  <StepCopyFields
                    orderedFields={orderedFields}
                    copied={copied}
                    nextField={nextField}
                    onCopy={handleCopy}
                  />
                )}
                {step === 3 && (
                  <StepOpenMarketplace
                    marketplaceLabel={meta.label}
                    onOpen={handleOpenMarketplace}
                    opened={marketplaceOpened}
                  />
                )}
                {step === 4 && (
                  <StepChecklist
                    checklist={checklist}
                    photosPrepared={photosPrepared}
                    copiedCount={copied.length}
                    totalFields={orderedFields.length}
                    nextField={nextField}
                    onToggle={toggleChecklist}
                    onCopyNext={() =>
                      nextField &&
                      handleCopy(nextField.key, nextField.label, nextField.value)
                    }
                  />
                )}
                {step === 5 && (
                  <StepRegisterUrl
                    marketplaceLabel={meta.label}
                    listing={q.data.listing}
                    urlInput={urlInput}
                    setUrlInput={setUrlInput}
                    onPaste={handlePaste}
                    onPublish={handlePublish}
                    publishing={publish.isPending}
                  />
                )}
              </>
            )}
          </div>

          {/* Bottom action bar */}
          <div className="shrink-0 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-[auto_1fr_auto] gap-2">
              <Button
                variant="outline"
                disabled={step === 0}
                onClick={() => handleStep(Math.max(0, step - 1))}
              >
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Button>
              {step === 2 && nextField ? (
                <Button
                  size="lg"
                  onClick={() =>
                    handleCopy(nextField.key, nextField.label, nextField.value)
                  }
                >
                  <Copy className="mr-2 h-4 w-4" /> Copy {nextField.label.toLowerCase()}
                </Button>
              ) : step === 4 && nextField ? (
                <Button
                  size="lg"
                  onClick={() =>
                    handleCopy(nextField.key, nextField.label, nextField.value)
                  }
                >
                  <Copy className="mr-2 h-4 w-4" /> Copy next: {nextField.label}
                </Button>
              ) : step < STEP_LABELS.length - 1 ? (
                <Button size="lg" onClick={() => handleStep(step + 1)}>
                  Continue <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button size="lg" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={handleOpenMarketplace}
                title={`Open ${meta.label}`}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Clipboard fallback dialog */}
      <Dialog open={!!fallback} onOpenChange={(o) => !o && setFallback(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy {fallback?.label}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Clipboard permission was denied. Tap the text below, select all, then copy
            manually.
          </p>
          <Textarea
            readOnly
            value={fallback?.text ?? ""}
            className="min-h-[120px]"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const ta = document.querySelector(
                  "[data-clipboard-fallback]",
                ) as HTMLTextAreaElement | null;
                ta?.select();
              }}
            >
              Select text
            </Button>
            <Button onClick={() => setFallback(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset posting progress?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears your wizard progress for {meta.label}. It will NOT remove a
              listing URL, the published date, or change the listing status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resetProgress}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ───── Steps ───── */

function StepReview({ data, onContinue }: { data: any; onContinue: () => void }) {
  const cover = data.photos.find((p: any) => p.is_cover) ?? data.photos[0];
  const get = (k: string) => data.payload.fields.find((f: any) => f.key === k)?.value;
  return (
    <div className="space-y-3">
      {cover?.url && (
        <img
          src={cover.url}
          alt=""
          className="aspect-square w-full rounded-lg object-cover"
        />
      )}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold leading-tight">{data.payload.title}</h2>
        <div className="text-2xl font-bold">{get("price") ?? "—"}</div>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Item label="Condition" value={get("condition")} />
        <Item label="Brand" value={get("brand")} />
        <Item label="Size" value={get("size")} />
        <Item label="Color" value={get("color")} />
      </dl>
      <div className="text-xs text-muted-foreground">
        <ImageIcon className="mr-1 inline h-3 w-3" /> {data.photos.length} photos
      </div>
      {data.missingFields.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          Missing information: {data.missingFields.join(", ")}
        </div>
      )}
      <Button className="w-full" onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={value ? "" : "italic text-muted-foreground"}>{value ?? "—"}</dd>
    </div>
  );
}

function StepPhotos({
  photos,
  productSku,
  onPrepared,
  prepared,
}: {
  photos: any[];
  productSku: string;
  onPrepared: () => void;
  prepared: boolean;
}) {
  const [sharing, setSharing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const filenameFor = (i: number, isCover: boolean) =>
    `${String(i + 1).padStart(2, "0")}-${isCover ? "cover" : "photo"}.jpg`;

  const fetchFiles = async (): Promise<{ files: File[]; failed: number[] }> => {
    const files: File[] = [];
    const failed: number[] = [];
    await Promise.all(
      photos.map(async (p, i) => {
        if (!p.url) {
          failed.push(i + 1);
          return;
        }
        try {
          const r = await fetch(p.url);
          if (!r.ok) throw new Error("fetch failed");
          const blob = await r.blob();
          const ext = blob.type.split("/")[1]?.split("+")[0] || "jpg";
          const name = filenameFor(i, !!p.is_cover).replace(/\.jpg$/, `.${ext}`);
          files.push(new File([blob], name, { type: blob.type || "image/jpeg" }));
        } catch {
          failed.push(i + 1);
        }
      }),
    );
    // Preserve order: cover first, then by position.
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { files, failed };
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      const { files, failed } = await fetchFiles();
      if (!files.length) {
        toast.error("Could not prepare photos");
        return;
      }
      if (!canShareFiles(files)) {
        toast.error("Sharing files not supported on this device");
        return;
      }
      await navigator.share({ files, title: productSku });
      if (failed.length)
        toast.warning(`Could not prepare photos: ${failed.join(", ")}`);
      onPrepared();
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error(e?.message || "Share failed");
    } finally {
      setSharing(false);
    }
  };

  const handleSaveOne = async (p: any, i: number) => {
    if (!p.url) return;
    try {
      const r = await fetch(p.url);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFor(i, !!p.is_cover);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onPrepared();
    } catch {
      // Open in new tab as last resort
      window.open(p.url, "_blank", "noopener,noreferrer");
      onPrepared();
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        Save these photos to your phone before opening the marketplace.
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleShare} disabled={sharing} className="flex-1 min-w-[140px]">
          {sharing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Share2 className="mr-2 h-4 w-4" />
          )}
          Share photos
        </Button>
        <Button
          variant="outline"
          onClick={onPrepared}
          className="flex-1 min-w-[140px]"
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          {prepared ? "Photos ready" : "Mark photos saved"}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p, i) => (
          <div key={p.id} className="relative">
            <button
              type="button"
              onClick={() => p.url && setPreview(p.url)}
              className="block aspect-square w-full overflow-hidden rounded border bg-muted"
            >
              {p.url ? (
                <img src={p.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-xs text-muted-foreground">
                  no
                </div>
              )}
            </button>
            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">
              {i + 1}
            </span>
            {p.is_cover && (
              <span className="absolute right-1 top-1 rounded bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                Cover
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 h-7 w-full text-xs"
              onClick={() => handleSaveOne(p, i)}
            >
              <Download className="mr-1 h-3 w-3" /> Save
            </Button>
          </div>
        ))}
      </div>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-[95vw] p-2 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="sr-only">Photo preview</DialogTitle>
          </DialogHeader>
          {preview && <img src={preview} alt="" className="w-full rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StepCopyFields({
  orderedFields,
  copied,
  nextField,
  onCopy,
}: {
  orderedFields: any[];
  copied: string[];
  nextField: any | null;
  onCopy: (key: string, label: string, value: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="text-xs text-muted-foreground">Next to copy</div>
        {nextField ? (
          <>
            <div className="mt-1 text-sm font-semibold">{nextField.label}</div>
            <div className="mt-1 line-clamp-2 text-sm">{nextField.value}</div>
          </>
        ) : (
          <div className="mt-1 text-sm text-muted-foreground">
            All fields copied. Open the marketplace and paste them.
          </div>
        )}
      </div>
      <ul className="space-y-1">
        {orderedFields.map((f) => {
          const done = copied.includes(f.key);
          return (
            <li
              key={f.key}
              className="flex items-center justify-between gap-2 rounded border p-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {done && <ClipboardCheck className="h-3 w-3 text-primary" />}
                  {f.label}
                </div>
                <div className="truncate text-sm">{f.value}</div>
              </div>
              <Button
                size="sm"
                variant={done ? "ghost" : "outline"}
                onClick={() => onCopy(f.key, f.label, f.value)}
              >
                {done ? "Copy again" : "Copy"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepOpenMarketplace({
  marketplaceLabel,
  onOpen,
  opened,
}: {
  marketplaceLabel: string;
  onOpen: () => void;
  opened: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        We'll open {marketplaceLabel} in a new tab. Your progress is saved — come back
        here when you've published the listing.
      </p>
      <Button size="lg" className="w-full" onClick={onOpen}>
        <ExternalLink className="mr-2 h-4 w-4" /> Open {marketplaceLabel}
      </Button>
      {opened && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          Marketplace already opened. Tap again to reopen, or continue to the checklist.
        </div>
      )}
    </div>
  );
}

function StepChecklist({
  checklist,
  photosPrepared,
  copiedCount,
  totalFields,
  nextField,
  onToggle,
  onCopyNext,
}: {
  checklist: Record<string, boolean>;
  photosPrepared: boolean;
  copiedCount: number;
  totalFields: number;
  nextField: any | null;
  onToggle: (k: string) => void;
  onCopyNext: () => void;
}) {
  const items: { key: string; label: string; auto?: boolean; checked: boolean }[] = [
    { key: "photos_saved", label: "Photos saved", auto: true, checked: photosPrepared },
    {
      key: "fields_copied",
      label: `Fields copied (${copiedCount}/${totalFields})`,
      auto: true,
      checked: copiedCount >= totalFields && totalFields > 0,
    },
    {
      key: "category_selected",
      label: "Category selected manually",
      checked: !!checklist.category_selected,
    },
    {
      key: "photos_uploaded",
      label: "Photos uploaded to marketplace",
      checked: !!checklist.photos_uploaded,
    },
    {
      key: "listing_published",
      label: "Listing published",
      checked: !!checklist.listing_published,
    },
  ];
  return (
    <div className="space-y-3">
      {nextField && (
        <Button className="w-full" onClick={onCopyNext}>
          <Copy className="mr-2 h-4 w-4" /> Copy next unfinished field: {nextField.label}
        </Button>
      )}
      <ul className="space-y-1">
        {items.map((it) => (
          <li
            key={it.key}
            className="flex items-center gap-3 rounded border p-3"
          >
            {it.auto ? (
              <CheckCircle2
                className={`h-5 w-5 ${
                  it.checked ? "text-primary" : "text-muted-foreground/40"
                }`}
              />
            ) : (
              <Checkbox
                checked={it.checked}
                onCheckedChange={() => onToggle(it.key)}
                id={it.key}
              />
            )}
            <Label
              htmlFor={it.key}
              className={`flex-1 text-sm ${it.checked ? "" : "text-muted-foreground"}`}
            >
              {it.label}
              {it.auto && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  auto
                </Badge>
              )}
            </Label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepRegisterUrl({
  marketplaceLabel,
  listing,
  urlInput,
  setUrlInput,
  onPaste,
  onPublish,
  publishing,
}: {
  marketplaceLabel: string;
  listing: any;
  urlInput: string;
  setUrlInput: (v: string) => void;
  onPaste: () => void;
  onPublish: () => void;
  publishing: boolean;
}) {
  const existingUrl = listing?.listing_url ?? null;
  const isActive = listing?.status === "active";
  return (
    <div className="space-y-3">
      {isActive && existingUrl ? (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="font-medium">Already published on {marketplaceLabel}</div>
          <a
            href={existingUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Open listing
          </a>
          <div className="mt-3 text-xs text-muted-foreground">
            You can update the saved URL below if needed.
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Paste the published listing URL from {marketplaceLabel} below.
        </p>
      )}
      <div className="space-y-2">
        <Label className="text-xs">Listing URL</Label>
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://…"
          inputMode="url"
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onPaste} className="flex-1">
            <Clipboard className="mr-1 h-4 w-4" /> Paste from clipboard
          </Button>
          <Button onClick={onPublish} disabled={!urlInput.trim() || publishing} className="flex-1">
            {publishing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {isActive ? "Update URL" : "Mark as published"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        <ChevronRight className="mr-1 inline h-3 w-3" />
        This does NOT mark the product as sold. Use the Advanced panel for that.
      </p>
    </div>
  );
}
