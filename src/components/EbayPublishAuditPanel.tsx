import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileSearch, Loader2 } from "lucide-react";
import {
  generateEbayPublishAudit,
  type EbayPublishAuditReport,
} from "@/lib/marketplaces/ebay/publish-audit.functions";

interface Props {
  productId: string;
}

function show(value: unknown) {
  if (value === null || value === undefined || value === "") return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function FieldGrid({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <div className="grid gap-1 rounded-md border p-2 text-xs sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <span className="text-muted-foreground">{label}: </span>
          <span className="break-words font-mono">{show(value)}</span>
        </div>
      ))}
    </div>
  );
}

function RawBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">{label}</summary>
      <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-2 text-[10px]">
{JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function AuditReport({ report }: { report: EbayPublishAuditReport }) {
  return (
    <div className="space-y-4">
      <Alert>
        <FileSearch className="h-4 w-4" />
        <AlertTitle>Conclusion: <span className="font-mono">{report.conclusion}</span></AlertTitle>
        <AlertDescription>
          Generated at <span className="font-mono">{report.generatedAt}</span>. Read-only audit; no publish or draft changes were executed.
        </AlertDescription>
      </Alert>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">1. Local product data</h4>
        <FieldGrid
          rows={[
            ["productId", report.localProduct.productId],
            ["SKU", report.localProduct.sku],
            ["internal condition", report.localProduct.internalCondition],
            ["ebay_category_id", report.localProduct.ebayCategoryId],
            ["ebay_category_name", report.localProduct.ebayCategoryName],
            ["ebay_condition_id", report.localProduct.ebayConditionId],
            ["ebay_condition_name", report.localProduct.ebayConditionName],
            ["ebay_condition_enum", report.localProduct.ebayConditionEnum],
            ["last field change", report.localProduct.lastChangedAt],
            ["product.updated_at", report.localProduct.fieldTimestamps.productUpdatedAt],
            ["listing.updated_at", report.localProduct.fieldTimestamps.listingUpdatedAt],
            ["draftOutdatedAt", report.localProduct.fieldTimestamps.draftOutdatedAt],
            ["draftCreatedAt", report.localProduct.fieldTimestamps.draftCreatedAt],
            ["offerCreatedAt", report.localProduct.fieldTimestamps.offerCreatedAt],
          ]}
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">2. Real eBay InventoryItem</h4>
        <FieldGrid
          rows={[
            ["SKU", report.inventoryItem.sku],
            ["condition", report.inventoryItem.condition],
            ["conditionDescription", report.inventoryItem.conditionDescription],
            ["title", report.inventoryItem.title],
          ]}
        />
        <RawBlock label="Raw InventoryItem GET response" value={report.inventoryItem.raw} />
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">3. Real Offer used by publish attempt</h4>
        <FieldGrid
          rows={[
            ["offerId", report.offer.offerId],
            ["status", report.offer.status],
            ["sku", report.offer.sku],
            ["marketplaceId", report.offer.marketplaceId],
            ["categoryId", report.offer.categoryId],
            ["merchantLocationKey", report.offer.merchantLocationKey],
            ["listingId", report.offer.listingId],
          ]}
        />
        <RawBlock label="listingPolicies" value={report.offer.listingPolicies} />
        <RawBlock label="Raw Offer GET response" value={report.offer.raw} />
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">4. Allowed conditions for real Offer category</h4>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">marketplaceId: {show(report.categoryConditionPolicies.marketplaceId)}</Badge>
          <Badge variant="outline">categoryId: {show(report.categoryConditionPolicies.categoryId)}</Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>conditionId</TableHead>
              <TableHead>conditionDisplayName</TableHead>
              <TableHead>conditionEnum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.categoryConditionPolicies.table.map((row) => (
              <TableRow key={`${row.conditionId}-${row.conditionEnum}`}>
                <TableCell className="font-mono">{row.conditionId}</TableCell>
                <TableCell>{show(row.conditionDisplayName)}</TableCell>
                <TableCell className="font-mono">{row.conditionEnum}</TableCell>
              </TableRow>
            ))}
            {!report.categoryConditionPolicies.table.length && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">No condition policy rows returned.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <RawBlock label="Raw getItemConditionPolicies response" value={report.categoryConditionPolicies.raw} />
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">5. Required comparison</h4>
        <FieldGrid
          rows={[
            ["dbCategoryId === offerCategoryId", report.comparisons.dbCategoryIdEqualsOfferCategoryId],
            ["dbConditionEnum === inventoryCondition", report.comparisons.dbConditionEnumEqualsInventoryCondition],
            ["inventoryCondition allowed by Offer category", report.comparisons.inventoryConditionAllowedForOfferCategory],
            ["dbConditionId allowed by Offer category", report.comparisons.dbConditionIdAllowedForOfferCategory],
            ["Offer is new or old", report.comparisons.offerIsNewOrOld],
            ["Offer vs last condition/category change", report.comparisons.offerCreatedBeforeOrAfterLastConditionChange],
            ["UNPUBLISHED offer count for SKU", report.comparisons.unpublishedOfferCountForSku],
            ["Published listing exists for SKU", report.comparisons.hasPublishedListingForSku],
          ]}
        />
        <RawBlock label="Other UNPUBLISHED offers for same SKU" value={report.comparisons.otherUnpublishedOffersForSku} />
      </section>
    </div>
  );
}

export function EbayPublishAuditPanel({ productId }: Props) {
  const fn = useServerFn(generateEbayPublishAudit);
  const audit = useMutation({
    mutationFn: () => fn({ data: { productId } }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSearch className="h-4 w-4" /> eBay Publish Audit
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => audit.mutate()} disabled={audit.isPending}>
          {audit.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSearch className="h-4 w-4 mr-1" />}
          Generate eBay Publish Audit
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Read-only diagnostic action. It does not publish, create offers, update inventory, delete offers, change category, change condition, or apply seller setup.</p>
        {audit.error && (
          <p className="text-destructive break-words">{(audit.error as any)?.message ?? String(audit.error)}</p>
        )}
        {audit.data && <AuditReport report={audit.data} />}
      </CardContent>
    </Card>
  );
}