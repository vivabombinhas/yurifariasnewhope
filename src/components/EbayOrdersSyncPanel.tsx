import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertCircle, Clock, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getEbayOrdersSyncStatus,
  syncEbayOrdersNow,
} from "@/lib/marketplaces/ebay/sync-orders.functions";

const STALE_MS = 30 * 60 * 1000;
const LOCK_TTL_MS = 10 * 60 * 1000;

function fmt(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function EbayOrdersSyncPanel() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getEbayOrdersSyncStatus);
  const runSync = useServerFn(syncEbayOrdersNow);
  const [busy, setBusy] = useState<"dry" | "real" | null>(null);
  const { data } = useQuery({
    queryKey: ["ebay-orders-sync-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 30_000,
  });

  if (!data?.connected) return null;

  const handleRun = async (dryRun: boolean) => {
    setBusy(dryRun ? "dry" : "real");
    try {
      const result = await runSync({ data: { dryRun } });
      const summary = `Pedidos: ${result.ordersFetched} · Itens: ${result.lineItemsProcessed} · Vendas: ${result.salesRecorded} · Não identificados: ${result.unmatchedItems}`;
      if (result.status === "success")
        toast.success(`${dryRun ? "Teste concluído" : "Sincronização concluída"} — ${summary}`);
      else if (result.status === "partial") toast.warning(`Sincronização parcial — ${summary}`);
      else toast.error(`Falha na sincronização — ${summary}`);
      qc.invalidateQueries({ queryKey: ["ebay-orders-sync-status"] });
      qc.invalidateQueries({ queryKey: ["sales-operations"] });
    } catch (error: any) {
      toast.error(`Erro de sincronização: ${error?.message ?? error}`);
    } finally {
      setBusy(null);
    }
  };

  const needsReconnect =
    data.accountStatus === "needs_reconnect" || data.lastStatus === "needs_reconnect";
  const lastSuccessMs = data.lastSuccessAt ? new Date(data.lastSuccessAt).getTime() : 0;
  const lockHeldMs = data.lockHeldAt ? new Date(data.lockHeldAt).getTime() : 0;
  const isError = data.lastStatus === "error";
  const isStale =
    !needsReconnect && !isError && lastSuccessMs > 0 && Date.now() - lastSuccessMs > STALE_MS;
  const lockStuck = data.lockHeld && lockHeldMs > 0 && Date.now() - lockHeldMs > LOCK_TTL_MS;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Sincronização automática do eBay</CardTitle>
        {needsReconnect ? (
          <Badge variant="destructive">Reconectar</Badge>
        ) : isError ? (
          <Badge variant="destructive">Atenção</Badge>
        ) : isStale ? (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            Atrasada
          </Badge>
        ) : data.lastStatus === "success" ? (
          <Badge variant="secondary">OK</Badge>
        ) : (
          <Badge variant="outline">Aguardando</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {needsReconnect && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Reconecte a conta do eBay</AlertTitle>
            <AlertDescription>
              A autorização expirou e precisa ser renovada nas Configurações.
            </AlertDescription>
          </Alert>
        )}
        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>A última sincronização falhou</AlertTitle>
            <AlertDescription>
              Execute novamente após publicar a atualização. Se continuar falhando, abra o
              diagnóstico técnico.
            </AlertDescription>
          </Alert>
        )}
        {isStale && (
          <Alert>
            <Clock className="h-4 w-4" />
            <AlertTitle>Sincronização atrasada</AlertTitle>
            <AlertDescription>
              Não houve uma sincronização bem-sucedida nos últimos 30 minutos.
            </AlertDescription>
          </Alert>
        )}
        {lockStuck && (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertTitle>Sincronização ocupada</AlertTitle>
            <AlertDescription>
              A próxima execução automática tentará liberar o processo.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-muted-foreground">Última sincronização</span>
          <span>{fmt(data.lastSuccessAt)}</span>
          <span className="text-muted-foreground">Última tentativa</span>
          <span>{fmt(data.lastAttemptAt)}</span>
          <span className="text-muted-foreground">Vendas encontradas (24h)</span>
          <span>{data.salesLast24h}</span>
          <span className="text-muted-foreground">Não identificadas (24h)</span>
          <span>{data.unmatchedLast24h}</span>
        </div>

        <Button
          className="w-full sm:w-auto"
          disabled={!!busy || needsReconnect}
          onClick={() => handleRun(false)}
        >
          {busy === "real" ? "Sincronizando…" : "Sincronizar vendas agora"}
        </Button>
        <p className="text-xs text-muted-foreground">
          A sincronização é automática. Use o botão somente para atualizar imediatamente ou tentar
          novamente após um erro.
        </p>

        <details className="rounded-md border p-3 text-xs">
          <summary className="cursor-pointer font-medium">Diagnóstico técnico</summary>
          <div className="mt-3 space-y-3">
            {data.lastError ? (
              <pre className="max-h-40 overflow-auto rounded bg-muted p-2">
                {JSON.stringify(data.lastError, null, 2)}
              </pre>
            ) : (
              <p className="text-muted-foreground">Nenhum erro técnico registrado.</p>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!!busy || needsReconnect}
              onClick={() => handleRun(true)}
            >
              {busy === "dry" ? "Executando…" : "Executar teste sem alterar dados"}
            </Button>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
