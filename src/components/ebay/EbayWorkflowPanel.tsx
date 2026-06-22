import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { checkEbayReadiness } from "@/lib/marketplaces/ebay/readiness.functions";

import { EbayCategoryPanel } from "@/components/EbayCategoryPanel";
import { EbayConditionPanel } from "@/components/EbayConditionPanel";
import { EbayAspectsPanel } from "@/components/EbayAspectsPanel";
import { EbayReadinessPanel } from "@/components/EbayReadinessPanel";
import { EbayDraftPanel } from "@/components/EbayDraftPanel";
import { EbaySellerSetupPanel } from "@/components/EbaySellerSetupPanel";
import { EbayPublishPreflightPanel } from "@/components/EbayPublishPreflightPanel";
import { EbayPublishAuditPanel } from "@/components/EbayPublishAuditPanel";
import { EbayPublishPanel } from "@/components/EbayPublishPanel";

interface Props {
  productId: string;
  product: any;
  onSaved: () => void;
}

type StepStatus = "pending" | "ok" | "warning" | "blocked";

interface StepDef {
  key: string;
  number: number;
  title: string;
  hint: string;
  status: StepStatus;
  statusLabel: string;
  primary: React.ReactNode;
  details?: React.ReactNode;
}

export function EbayWorkflowPanel({ productId, product, onSaved }: Props) {
  const readinessFn = useServerFn(checkEbayReadiness);
  const readiness = useQuery({
    queryKey: ["ebay-readiness", productId],
    queryFn: () => readinessFn({ data: { productId } }),
    staleTime: 15_000,
  });

  const listing = useQuery({
    queryKey: ["ebay-listing", productId],
    queryFn: async () => {
      const { data } = await supabase
        .from("marketplace_listings")
        .select("status, external_listing_id, provider_metadata, error_message, updated_at")
        .eq("product_id", productId)
        .eq("marketplace", "ebay")
        .maybeSingle();
      return data;
    },
    staleTime: 10_000,
  });

  const meta = (listing.data?.provider_metadata ?? null) as
    | { offerId?: string; draftOutdated?: boolean }
    | null;
  const isDraft = listing.data?.status === "draft" && !!meta?.offerId;
  const isActive = listing.data?.status === "active";
  const isOutdated = !!meta?.draftOutdated;

  const checkStatus = (id: string) =>
    readiness.data?.checks.find((c) => c.id === id)?.status ?? "missing";

  const steps: StepDef[] = useMemo(() => {
    const accountOk = checkStatus("account") === "ok";
    const categoryOk = checkStatus("category") === "ok";
    const conditionOk = checkStatus("ebay_condition") === "ok";
    const aspectsOk =
      checkStatus("aspects") === "ok" && checkStatus("required_aspects") === "ok";
    const setupOk = accountOk && categoryOk && conditionOk;

    const setupStatus: StepStatus = !accountOk
      ? "blocked"
      : setupOk
        ? "ok"
        : "pending";

    const listingStatus: StepStatus = !setupOk
      ? "blocked"
      : aspectsOk
        ? "ok"
        : "pending";

    const draftStatus: StepStatus = !setupOk || !aspectsOk
      ? "blocked"
      : isActive
        ? "ok"
        : isOutdated
          ? "warning"
          : isDraft
            ? "ok"
            : "pending";

    const publishStatus: StepStatus = isActive
      ? "ok"
      : !isDraft || isOutdated
        ? "blocked"
        : "pending";

    return [
      {
        key: "setup",
        number: 1,
        title: "Setup",
        hint: "Conta eBay, categoria oficial e condição válida para a categoria.",
        status: setupStatus,
        statusLabel: !accountOk
          ? "Conecte sua conta eBay"
          : setupOk
            ? "Pronto"
            : "Selecione categoria e condição",
        primary: (
          <div className="space-y-4">
            <EbayCategoryPanel product={product} onSaved={onSaved} />
            <EbayConditionPanel product={product} onSaved={onSaved} />
          </div>
        ),
      },
      {
        key: "listing",
        number: 2,
        title: "Listing Data",
        hint: "Item specifics e checagem final dos dados do produto.",
        status: listingStatus,
        statusLabel:
          listingStatus === "blocked"
            ? "Termine o Setup primeiro"
            : listingStatus === "ok"
              ? "Todos os campos prontos"
              : "Preencha os specifics obrigatórios",
        primary: (
          <div className="space-y-4">
            <EbayAspectsPanel product={product} onSaved={onSaved} />
            <EbayReadinessPanel productId={productId} />
          </div>
        ),
      },
      {
        key: "draft",
        number: 3,
        title: "Draft",
        hint: "Cria a oferta não publicada no eBay.",
        status: draftStatus,
        statusLabel:
          draftStatus === "blocked"
            ? "Conclua Setup e Listing Data"
            : isActive
              ? "Publicado — draft não se aplica"
              : isOutdated
                ? "Draft desatualizado — recrie"
                : isDraft
                  ? "Draft pronto"
                  : "Crie o draft",
        primary: <EbayDraftPanel productId={productId} />,
      },
      {
        key: "publish",
        number: 4,
        title: "Publish",
        hint: "Seller setup + publicação da oferta no eBay.",
        status: publishStatus,
        statusLabel: isActive
          ? "Listing ativo no eBay"
          : publishStatus === "blocked"
            ? "Crie/atualize o draft primeiro"
            : "Pronto para publicar",
        primary: <EbayPublishPanel productId={productId} />,
        details:
          publishStatus === "ok"
            ? undefined
            : (
                <div className="space-y-4">
                  <EbaySellerSetupPanel productId={productId} />
                  <EbayPublishPreflightPanel productId={productId} />
                  <EbayPublishAuditPanel productId={productId} />
                </div>
              ),
      },
    ];
  }, [
    productId,
    product,
    onSaved,
    readiness.data,
    isActive,
    isDraft,
    isOutdated,
  ]);

  // Auto-open the first non-OK step
  const initialOpen = steps.find((s) => s.status !== "ok")?.key ?? steps[0].key;
  const [openKey, setOpenKey] = useState<string>(initialOpen);

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <StepCard
          key={step.key}
          step={step}
          open={openKey === step.key}
          onToggle={() => setOpenKey(openKey === step.key ? "" : step.key)}
        />
      ))}
    </div>
  );
}

function StepCard({
  step,
  open,
  onToggle,
}: {
  step: StepDef;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        step.status === "blocked" && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 rounded-lg"
      >
        <StepIcon status={step.status} number={step.number} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">
            {step.number}. {step.title}
          </div>
          <div className="text-xs text-muted-foreground truncate">{step.hint}</div>
        </div>
        <StatusBadge status={step.status} label={step.statusLabel} />
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t px-4 py-4 space-y-4">
          {step.primary}
          {step.details && (
            <details className="rounded-md border bg-muted/30">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">
                Detalhes técnicos (seller setup, preflight, audit)
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-3">{step.details}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function StepIcon({ status, number }: { status: StepStatus; number: number }) {
  if (status === "ok")
    return <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />;
  if (status === "warning")
    return <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
  if (status === "blocked")
    return (
      <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center text-[10px] text-muted-foreground/60">
        {number}
      </div>
    );
  return (
    <Circle className="h-5 w-5 text-muted-foreground" />
  );
}

function StatusBadge({ status, label }: { status: StepStatus; label: string }) {
  const variant: "default" | "secondary" | "destructive" | "outline" =
    status === "ok"
      ? "default"
      : status === "warning"
        ? "destructive"
        : status === "blocked"
          ? "outline"
          : "secondary";
  return (
    <Badge variant={variant} className="hidden sm:inline-flex shrink-0">
      {label}
    </Badge>
  );
}
