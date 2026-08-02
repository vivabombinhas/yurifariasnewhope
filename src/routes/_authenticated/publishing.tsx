import { useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { markAssistedClosed } from "@/lib/marketplaces/assisted.functions";
import {
  listSalesOperations,
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

      <EbayOrdersSyncPanel />

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
                    <Badge
                      variant={sale.processing_status === "matched" ? "secondary" : "destructive"}
                    >
                      {sale.processing_status === "matched" ? "Identificado" : "Revisar"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
