import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle,
  Brain,
  Copy,
  ExternalLink,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import {
  runResearchAgent,
  type ResearchAgentReport,
  type ResearchHypothesis,
  type ExternalSearchTarget,
} from "@/lib/research-agent.functions";
import { withTimeout } from "@/lib/async-timeout";
import type { AiSuggestion, AiResearchResult } from "@/lib/ai-suggestions.functions";

const SOURCE_LABEL: Record<ExternalSearchTarget["source"], string> = {
  ebay_sold: "eBay sold",
  google_search: "Google",
  google_lens: "Google Lens",
  stockx: "StockX",
  goat: "GOAT",
  collectibles_marketplace: "Collectibles",
};

function copy(text: string, label = "copied") {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(label),
    () => toast.error("Copy failed"),
  );
}

function priceText(h: ResearchHypothesis): string {
  const { low, high } = h.estimated_price_range_usd;
  if (low == null && high == null) return "Manual pricing — no safe estimate";
  if (low != null && high != null) return `$${low.toFixed(0)} – $${high.toFixed(0)} USD`;
  if (low != null) return `≥ $${low.toFixed(0)} USD`;
  return `≤ $${high?.toFixed(0)} USD`;
}

function ConfidenceBar({ value, band }: { value: number; band: ResearchHypothesis["confidence_band"] }) {
  const pct = Math.round(value * 100);
  const color =
    band === "high" ? "bg-emerald-500" : band === "medium" ? "bg-amber-500" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-1.5 w-20 rounded bg-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

export function ResearchAgentPanel({
  productId,
  suggestion,
  research,
}: {
  productId: string;
  suggestion: AiSuggestion | null;
  research: AiResearchResult | null;
}) {
  const runFn = useServerFn(runResearchAgent);
  const [report, setReport] = useState<ResearchAgentReport | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      const visual_clues =
        research?.visual_clues ?? suggestion?.visual_clues ?? [];
      const search_keywords =
        research?.search_keywords ?? suggestion?.search_keywords ?? [];
      const possible_brand =
        research?.possible_brand ?? suggestion?.possible_brand ?? "";
      const possible_model =
        research?.possible_model ?? suggestion?.possible_model ?? "";
      return withTimeout(
        runFn({
          data: {
            productId,
            title: suggestion?.title,
            description: suggestion?.description,
            possible_brand,
            possible_model,
            visual_clues,
            search_keywords,
          },
        }),
        55_000,
        "Research Agent timed out. Please retry.",
      );
    },
    onSuccess: (r) => {
      setReport(r);
      toast.success("Research report ready — verify hypotheses manually.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Research Agent failed"),
  });

  const canRun = !!suggestion || !!research;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" /> Research Agent
          <Badge variant="outline" className="text-[10px] ml-1">
            foundation
          </Badge>
        </CardTitle>
        <div className="flex gap-2">
          {report && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copy(JSON.stringify(report, null, 2), "Report JSON copied")}
              title="Copy the full research report JSON"
            >
              <Copy className="h-4 w-4 mr-1" /> Copy report JSON
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => !m.isPending && canRun && m.mutate()}
            disabled={m.isPending || !canRun}
            aria-busy={m.isPending}
            title={
              canRun
                ? "Generate structured identification hypotheses"
                : "Run Analyze with AI (and optionally Improve with Research) first"
            }
          >
            {m.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Brain className="h-4 w-4 mr-1" />
            )}
            {m.isPending ? "Researching…" : report ? "Re-run agent" : "Run Research Agent"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!canRun && (
          <p className="text-sm text-muted-foreground">
            Run AI analysis first to enable Research Agent.
          </p>
        )}
        {canRun && !report && !m.isPending && (
          <p className="text-sm text-muted-foreground">
            Generates ranked identification hypotheses, confidence, estimated price range,
            sale keywords, research queries and a manual verification checklist.
            Nothing is applied to the product automatically.
          </p>
        )}
        {m.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {(m.error as any)?.message ?? "Research Agent failed"}
          </div>
        )}
        {report && (
          <ReportView
            report={report}
            onCopy={() => copy(JSON.stringify(report, null, 2), "Report JSON copied")}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ReportView({
  report,
  onCopy,
}: {
  report: ResearchAgentReport;
  onCopy: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [top, ...rest] = report.hypotheses;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
        <div>
          <div className="font-medium text-foreground">Hypotheses only — verify manually</div>
          <div className="text-muted-foreground">
            Nothing here is applied to the product. Pricing is never set automatically.
          </div>
        </div>
      </div>

      {!top ? (
        <p className="text-sm text-muted-foreground">
          No hypotheses produced. Try adding more photos or running Improve with Research first.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Top hypothesis
            </div>
            <HypothesisCard h={top} />
          </div>

          {top.verification_checklist.length === 0 && report.global_verification_checklist.length > 0 && (
            <Section title="Manual verification checklist">
              <ul className="list-disc pl-5 text-sm space-y-0.5">
                {report.global_verification_checklist.map((v, i) => (
                  <li key={i}>⚠ {v}</li>
                ))}
              </ul>
            </Section>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={onCopy}>
              <Copy className="h-4 w-4 mr-1" /> Copy report JSON
            </Button>
            {(rest.length > 0 ||
              report.global_sale_keywords.length > 0 ||
              report.global_search_queries.length > 0 ||
              report.global_verification_checklist.length > 0 ||
              report.cross_source_strategy) && (
              <Button size="sm" variant="outline" onClick={() => setShowAll((s) => !s)}>
                {showAll
                  ? "Hide details"
                  : rest.length > 0
                  ? `Show all hypotheses (${rest.length} more)`
                  : "Show details"}
              </Button>
            )}
          </div>

          {showAll && (
            <div className="space-y-4 border-t pt-4">
              {rest.length > 0 && (
                <Section title="Other hypotheses">
                  <div className="space-y-3">
                    {rest.map((h) => (
                      <HypothesisCard key={h.rank} h={h} />
                    ))}
                  </div>
                </Section>
              )}

              {report.global_sale_keywords.length > 0 && (
                <Section title="Sale keywords (resale-optimized)">
                  <div className="flex flex-wrap gap-1 items-center">
                    {report.global_sale_keywords.map((k, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">
                        {k}
                      </Badge>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copy(report.global_sale_keywords.join(", "), "Keywords copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </Section>
              )}

              {report.global_search_queries.length > 0 && (
                <Section title="Cross-hypothesis research queries">
                  <ul className="space-y-1">
                    {report.global_search_queries.map((q, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-sm">
                        <span className="break-words">{q}</span>
                        <Button size="sm" variant="ghost" onClick={() => copy(q, "Query copied")}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {report.global_verification_checklist.length > 0 && top.verification_checklist.length > 0 && (
                <Section title="Global verification checklist">
                  <ul className="list-disc pl-5 text-sm space-y-0.5">
                    {report.global_verification_checklist.map((v, i) => (
                      <li key={i}>⚠ {v}</li>
                    ))}
                  </ul>
                </Section>
              )}

              {report.cross_source_strategy && (
                <Section title="Cross-source strategy">
                  <p className="text-sm text-muted-foreground">{report.cross_source_strategy}</p>
                </Section>
              )}

              <p className="text-[10px] text-muted-foreground">
                Generated {new Date(report.generated_at).toLocaleString()}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </div>
      {children}
    </div>
  );
}

function HypothesisCard({ h }: { h: ResearchHypothesis }) {
  const noPrice = h.estimated_price_range_usd.low == null && h.estimated_price_range_usd.high == null;
  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">#{h.rank}</Badge>
            <div className="font-medium">{h.label || "Unnamed hypothesis"}</div>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {[h.possible_brand, h.possible_model, h.category_hint, h.era_or_release_hint]
              .filter(Boolean)
              .join(" • ") || "—"}
          </div>
        </div>
        <ConfidenceBar value={h.confidence} band={h.confidence_band} />
      </div>

      {h.rationale && (
        <p className="text-sm text-muted-foreground">{h.rationale}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={noPrice ? "destructive" : "secondary"} className="text-[10px]">
          {priceText(h)}
        </Badge>
        {noPrice && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {h.estimated_price_range_usd.basis}
          </span>
        )}
      </div>

      {(h.supporting_clues.length > 0 || h.conflicting_clues.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {h.supporting_clues.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1">Supporting clues</div>
              <div className="flex flex-wrap gap-1">
                {h.supporting_clues.map((c, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
                ))}
              </div>
            </div>
          )}
          {h.conflicting_clues.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1">Conflicting clues</div>
              <div className="flex flex-wrap gap-1">
                {h.conflicting_clues.map((c, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">{c}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {h.verification_checklist.length > 0 && (
        <div className="text-xs">
          <div className="text-muted-foreground mb-1">Verify this hypothesis</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {h.verification_checklist.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}

      {h.external_search_targets.length > 0 && (
        <div className="text-xs">
          <div className="text-muted-foreground mb-1">External lookup targets (not yet executed)</div>
          <ul className="space-y-1">
            {h.external_search_targets.map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1">
                <div className="min-w-0">
                  <Badge variant="outline" className="text-[10px] mr-1">
                    {SOURCE_LABEL[t.source]}
                  </Badge>
                  <span className="break-all">{t.query || "(no query)"}</span>
                  {t.intent && (
                    <div className="text-[10px] text-muted-foreground">{t.intent}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => copy(t.query, "Query copied")}>
                    <Copy className="h-3 w-3" />
                  </Button>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent"
                    title={`Open in ${SOURCE_LABEL[t.source]}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
