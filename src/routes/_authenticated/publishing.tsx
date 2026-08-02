import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import { EbayOrdersSyncPanel } from "@/components/EbayOrdersSyncPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { markAssistedClosed } from "@/lib/marketplaces/assisted.functions";
import {
  listSalesOperations,
  reconcileEbaySale,
  ignoreUnmatchedEbaySale,
  registerManualSale,
  searchSellableProducts,
} from "@/lib/sales-operations.functions";

export const Route = createFileRoute("/_authenticated/publishing")({
  component: SalesOperationsPage,
});

function marketplaceName(value: string) {
  if (value === "poshmark") return "Poshmark";
  if (value === "depop") return "Depop";
  if (value === "local") return "Local / outro";
  return "eBay";
}

function fmt(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function SalesOperationsPage() {
  const qc = useQueryClient();
  const load = useServerFn(listSalesOperations);
  const confirmClosed = useServerFn(markAssistedClosed);
  const searchProducts = useServerFn(searchSellableProducts);
  const saveManualSale = useServerFn(registerManualSale);
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [soldOn, setSoldOn] = useState<"ebay" | "poshmark" | "depop" | "local">("local");
  const [reviewSale, setReviewSale] = useState<any | null>(null);
  const query = useQuery({
    queryKey: ["sales-operations"],
    queryFn: () => load(),
    refetchInterval: 30_000,
  });
  const closeMutation = useMutation({
    mutationFn: (row: { product_id: string; marketplace: "poshmark" | "depop" }) =>
      confirmClosed({ data: { productId: row.product_id, marketplace: row.marketplace } }),
    onSuccess: () => {
      toast.success("Remoção confirmada.");
      qc.invalidateQueries({ queryKey: ["sales-operations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const productsQuery = useQuery({
    queryKey: ["sellable-products", search],
    queryFn: () => searchProducts({ data: { search } }),
    staleTime: 10_000,
  });
  const saleMutation = useMutation({
    mutationFn: () => saveManualSale({ data: { productId: selectedProductId, soldOn } }),
    onSuccess: (result) => {
      const manual = result.closureResults.filter((item) => item.status === "manual_required");
      const failed = result.closureResults.filter((item) => item.status === "failed");
      toast.success("Venda registrada e estoque atualizado.");
      if (manual.length) toast.warning(`${manual.length} anúncio(s) aguardando remoção manual.`);
      if (failed.length) toast.error(`${failed.length} anúncio(s) não puderam ser encerrados.`);
      setSelectedProductId("");
      setSearch("");
      qc.invalidateQueries({ queryKey: ["sales-operations"] });
      qc.invalidateQueries({ queryKey: ["sellable-products"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pending = query.data?.pendingClosures ?? [];
  const sales = query.data?.recentSales ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ShoppingBag className="h-5 w-5" /> Vendas e remoções
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sincronize vendas do eBay e retire rapidamente os mesmos produtos dos outros canais.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => query.refetch()}
          aria-label="Atualizar"
        >
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registrar venda manual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sale-search">Produto vendido</Label>
            <Input
              id="sale-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedProductId("");
              }}
              placeholder="Digite o SKU ou o título"
              className="h-11"
            />
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {(productsQuery.data ?? []).map((product: any) => (
                <button
                  type="button"
                  key={product.id}
                  onClick={() => setSelectedProductId(product.id)}
                  className={`w-full rounded-md border p-3 text-left text-sm transition-colors ${
                    selectedProductId === product.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">{product.title || "Produto sem título"}</div>
                  <div className="text-xs text-muted-foreground">{product.sku}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Onde foi vendido?</Label>
            <Select value={soldOn} onValueChange={(value) => setSoldOn(value as typeof soldOn)}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ebay">eBay</SelectItem>
                <SelectItem value="poshmark">Poshmark</SelectItem>
                <SelectItem value="depop">Depop</SelectItem>
                <SelectItem value="local">Local / outro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            className="h-12 w-full text-base"
            disabled={!selectedProductId || saleMutation.isPending}
            onClick={() => {
              const product = productsQuery.data?.find(
                (item: any) => item.id === selectedProductId,
              );
              if (
                confirm(
                  `Confirmar venda de ${product?.sku ?? "este produto"} em ${marketplaceName(soldOn)}?`,
                )
              ) {
                saleMutation.mutate();
              }
            }}
          >
            {saleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar venda
          </Button>
          <p className="text-xs text-muted-foreground">
            O estoque será marcado como vendido. O eBay será encerrado automaticamente quando
            aplicável; Poshmark e Depop aparecerão abaixo para remoção pelo link salvo.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            Remoções pendentes
            <Badge variant={pending.length ? "destructive" : "secondary"}>{pending.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma remoção pendente.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((row: any) => (
                <div key={row.id} className="rounded-lg border p-3">
                  <div className="mb-3 min-w-0">
                    <Link
                      to="/products/$id"
                      params={{ id: row.product_id }}
                      className="font-medium hover:underline"
                    >
                      {row.product?.title || "Produto sem título"}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {row.product?.sku} · remover do {marketplaceName(row.marketplace)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button asChild variant="outline" className="h-11">
                      <a href={row.listing_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" /> Abrir anúncio
                      </a>
                    </Button>
                    <Button
                      className="h-11"
                      disabled={closeMutation.isPending}
                      onClick={() => closeMutation.mutate(row)}
                    >
                      Confirmar remoção
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vendas recentes do eBay</CardTitle>
        </CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma venda sincronizada ainda.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {sales.map((sale: any) => (
                <div key={sale.id} className="p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {sale.product_id ? (
                        <Link
                          to="/products/$id"
                          params={{ id: sale.product_id }}
                          className="font-medium hover:underline"
                        >
                          {sale.product?.title || sale.sku || "Produto"}
                        </Link>
                      ) : (
                        <span className="font-medium">{sale.sku || "Item não identificado"}</span>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Pedido {sale.external_order_id} · {fmt(sale.order_created_at)}
                      </div>
                    </div>
                    {sale.processing_status === "matched" ? (
                      <Badge variant="secondary">Identificado</Badge>
                    ) : sale.processing_status === "ignored" ? (
                      <Badge variant="outline">Ignorado</Badge>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => setReviewSale(sale)}>
                        Revisar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <EbayOrdersSyncPanel />
      <ReviewSaleDialog
        sale={reviewSale}
        open={!!reviewSale}
        onOpenChange={(open) => !open && setReviewSale(null)}
        onResolved={() => {
          setReviewSale(null);
          query.refetch();
        }}
      />
    </div>
  );
}

function lineItemTitle(sale: any): string | null {
  const items = sale?.raw_order_redacted?.lineItems;
  if (!Array.isArray(items)) return null;
  const item = items.find((value: any) => value?.lineItemId === sale.external_line_item_id);
  return typeof item?.title === "string" && item.title.trim() ? item.title.trim() : null;
}

function ReviewSaleDialog({
  sale,
  open,
  onOpenChange,
  onResolved,
}: {
  sale: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
}) {
  const searchFn = useServerFn(searchSellableProducts);
  const reconcileFn = useServerFn(reconcileEbaySale);
  const ignoreFn = useServerFn(ignoreUnmatchedEbaySale);
  const initialSearch = sale?.sku || lineItemTitle(sale) || "";
  const [search, setSearch] = useState(initialSearch);
  const [selectedProductId, setSelectedProductId] = useState("");
  useEffect(() => {
    setSearch(sale?.sku || lineItemTitle(sale) || "");
    setSelectedProductId("");
  }, [sale?.id]);
  const products = useQuery({
    queryKey: ["sale-product-suggestions", sale?.id, search],
    queryFn: () => searchFn({ data: { search } }),
    enabled: open && !!sale,
  });
  const reconcile = useMutation({
    mutationFn: () => reconcileFn({ data: { saleId: sale.id, productId: selectedProductId } }),
    onSuccess: (result) => {
      toast.success("Venda vinculada e produto marcado como vendido.");
      const pending = result.closureResults.filter((item) => item.status === "manual_required");
      if (pending.length) toast.warning(`${pending.length} remoção(ões) aguardando confirmação.`);
      onResolved();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const ignore = useMutation({
    mutationFn: () => ignoreFn({ data: { saleId: sale.id } }),
    onSuccess: () => {
      toast.success("Venda antiga ou externa ignorada.");
      onResolved();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Revisar venda não identificada</DialogTitle>
          <DialogDescription>
            Confirme o produto correto. O sistema nunca fará essa associação apenas pela semelhança
            do título.
          </DialogDescription>
        </DialogHeader>
        {sale && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Pedido</span>
              <span>{sale.external_order_id}</span>
              <span className="text-muted-foreground">SKU do eBay</span>
              <span>{sale.sku || "Não informado"}</span>
              <span className="text-muted-foreground">ID do anúncio</span>
              <span>{sale.external_listing_id || "Não informado"}</span>
              <span className="text-muted-foreground">Título</span>
              <span>{lineItemTitle(sale) || "Não disponível neste pedido antigo"}</span>
              <span className="text-muted-foreground">Quantidade</span>
              <span>{sale.quantity ?? 1}</span>
              <span className="text-muted-foreground">Data</span>
              <span>{fmt(sale.order_created_at)}</span>
            </div>
            <div className="space-y-2">
              <Label>Buscar produto por SKU ou título</Label>
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSelectedProductId("");
                }}
                placeholder="SKU ou título do produto"
                className="h-11"
              />
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {(products.data ?? []).map((product: any) => (
                  <button
                    type="button"
                    key={product.id}
                    onClick={() => setSelectedProductId(product.id)}
                    className={`w-full rounded-md border p-3 text-left ${selectedProductId === product.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                  >
                    <div className="text-sm font-medium">
                      {product.title || "Produto sem título"}
                    </div>
                    <div className="text-xs text-muted-foreground">{product.sku}</div>
                  </button>
                ))}
              </div>
            </div>
            <Button
              className="h-12 w-full"
              disabled={!selectedProductId || reconcile.isPending}
              onClick={() => {
                const product = products.data?.find((item: any) => item.id === selectedProductId);
                if (
                  confirm(
                    `Vincular esta venda a ${product?.sku ?? "este produto"} e marcá-lo como vendido?`,
                  )
                )
                  reconcile.mutate();
              }}
            >
              {reconcile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Vincular e marcar como vendido
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={ignore.isPending}
              onClick={() => {
                if (
                  confirm(
                    "Ignorar esta venda como anúncio antigo ou externo? Nenhum produto será alterado.",
                  )
                )
                  ignore.mutate();
              }}
            >
              Ignorar anúncio antigo/externo
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
