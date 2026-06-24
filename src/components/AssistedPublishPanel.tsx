import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Smartphone,
  ShoppingBag,
  Tag,
} from "lucide-react";
import {
  getAssistedListing,
  prepareAssistedListing,
  markAssistedPublished,
  markAssistedSold,
} from "@/lib/marketplaces/assisted.functions";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import { MobilePostingWizard } from "@/components/MobilePostingWizard";


interface Props {
  marketplace: MarketplaceId;
  productId: string;
  onSaved?: () => void;
}

export function AssistedPublishPanel({ marketplace, productId, onSaved }: Props) {
  const qc = useQueryClient();
  const meta = MARKETPLACES.find((m) => m.id === marketplace)!;
  const getFn = useServerFn(getAssistedListing);
  const prepareFn = useServerFn(prepareAssistedListing);
  const publishFn = useServerFn(markAssistedPublished);
  const soldFn = useServerFn(markAssistedSold);

  const queryKey = ["assisted-listing", marketplace, productId];
  const q = useQuery({
    queryKey,
    queryFn: () => getFn({ data: { productId, marketplace } }),
    staleTime: 10_000,
  });

  const [url, setUrl] = useState("");

  const prepare = useMutation({
    mutationFn: () => prepareFn({ data: { productId, marketplace } }),
    onSuccess: () => {
      toast.success("Listing prepared");
      qc.invalidateQueries({ queryKey });
      onSaved?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: (listingUrl: string) =>
      publishFn({ data: { productId, marketplace, listingUrl } }),
    onSuccess: () => {
      toast.success("Marked as published");
      setUrl("");
      qc.invalidateQueries({ queryKey });
      onSaved?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sold = useMutation({
    mutationFn: () => soldFn({ data: { productId, marketplace } }),
    onSuccess: (res) => {
      toast.success("Marked as sold");
      if (res.otherActive?.length) {
        toast.warning(
          `Still active on: ${res.otherActive
            .map((o: any) => o.marketplace.replace(/_/g, " "))
            .join(", ")}. End them manually.`,
        );
      }
      qc.invalidateQueries({ queryKey });
      onSaved?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allText = useMemo(() => {
    if (!q.data) return "";
    const lines = [`${q.data.payload.title}`, ""];
    for (const f of q.data.payload.fields) {
      if (f.value) lines.push(`${f.label}: ${f.value}`);
    }
    lines.push("", q.data.payload.description);
    return lines.join("\n");
  }, [q.data]);

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="p-3 text-sm text-destructive">
        {(q.error as Error)?.message ?? "Failed to load."}
      </div>
    );
  }

  const { payload, missingFields, photos, listing } = q.data;
  const status = listing?.status ?? null;
  const listingUrl = listing?.listing_url ?? null;
  const isPublished = status === "active";
  const isSold = status === "sold";

  return (
    <div className="space-y-3 p-3">
      {/* Mobile wizard launcher — primary action */}
      <MobileLauncher marketplace={marketplace} productId={productId} onSaved={onSaved} />

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between text-xs">
            Advanced manual posting
            <ChevronDown className="h-3 w-3" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">

      {/* Status row */}
      <div className="flex flex-wrap items-center gap-2">
        {isSold ? (
          <Badge variant="secondary" className="gap-1">
            <ShoppingBag className="h-3 w-3" /> Sold
          </Badge>
        ) : isPublished ? (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Published
          </Badge>
        ) : status === "draft" ? (
          <Badge variant="outline" className="gap-1">
            <Tag className="h-3 w-3" /> Ready to post
          </Badge>
        ) : (
          <Badge variant="outline">Not prepared</Badge>
        )}
        {listingUrl && (
          <a
            href={listingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> View listing
          </a>
        )}
      </div>

      {/* Missing fields */}
      {missingFields.length > 0 && !isPublished && !isSold && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <div className="flex items-center gap-1 font-medium">
            <AlertCircle className="h-3.5 w-3.5" /> Missing required fields
          </div>
          <ul className="ml-4 mt-1 list-disc">
            {missingFields.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Prepared fields */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground uppercase">
            Prepared listing
          </div>
          <Button size="sm" variant="outline" onClick={() => copy(allText, "All fields")}>
            <Copy className="mr-1 h-3 w-3" /> Copy all
          </Button>
        </div>

        <FieldRow label="Title" value={payload.title} />
        {payload.fields
          .filter((f) => f.key !== "title")
          .map((f) => (
            <FieldRow
              key={f.key}
              label={f.label}
              value={f.value}
              required={f.required}
            />
          ))}

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Description</Label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copy(payload.description, "Description")}
            >
              <Copy className="mr-1 h-3 w-3" /> Copy
            </Button>
          </div>
          <Textarea
            readOnly
            value={payload.description}
            className="min-h-[120px] text-xs"
          />
        </div>
      </div>

      {/* Photos */}
      {photos.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase">
            <ImageIcon className="h-3 w-3" /> Photos ({photos.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {photos.map((p) =>
              p.url ? (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block h-16 w-16 overflow-hidden rounded border hover:opacity-80"
                  title={p.is_cover ? "Cover photo" : `Photo ${p.position + 1}`}
                >
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  {p.is_cover && (
                    <span className="absolute bottom-0 left-0 right-0 bg-primary/80 text-center text-[9px] text-primary-foreground">
                      Cover
                    </span>
                  )}
                </a>
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 border-t pt-3">
        {!status && (
          <Button
            size="sm"
            onClick={() => prepare.mutate()}
            disabled={prepare.isPending}
          >
            {prepare.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Prepare listing
          </Button>
        )}
        <Button size="sm" variant="outline" asChild>
          <a href={meta.sellUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1 h-3 w-3" /> Open {meta.label}
          </a>
        </Button>
      </div>

      {/* Mark as published */}
      {!isSold && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <Label className="text-xs">
            {isPublished ? "Update listing URL" : "Paste listing URL after posting"}
          </Label>
          <div className="flex gap-2">
            <Input
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-9 text-xs"
            />
            <Button
              size="sm"
              onClick={() => publish.mutate(url)}
              disabled={!url.trim() || publish.isPending}
            >
              {publish.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {isPublished ? "Update" : "Mark as published"}
            </Button>
          </div>
        </div>
      )}

      {/* Mark as sold */}
      {isPublished && !isSold && (
        <div className="border-t pt-3">
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              if (
                confirm(
                  `Mark this product as sold on ${meta.label}? This will also mark the product itself as sold.`,
                )
              ) {
                sold.mutate();
              }
            }}
            disabled={sold.isPending}
          >
            {sold.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Mark as sold
          </Button>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  value,
  required,
}: {
  label: string;
  value: string | null;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-24 shrink-0 text-muted-foreground">{label}</div>
      <div
        className={`flex-1 truncate ${
          value ? "" : required ? "text-destructive italic" : "text-muted-foreground italic"
        }`}
      >
        {value ?? (required ? "missing" : "—")}
      </div>
      {value && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2"
          onClick={() => copy(value, label)}
        >
          <Copy className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Copy failed");
  }
}
