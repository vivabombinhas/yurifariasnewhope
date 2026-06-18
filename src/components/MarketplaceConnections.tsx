import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  getEbayAccount,
  startEbayOAuth,
  disconnectEbay,
} from "@/lib/marketplaces/ebay/account.functions";

export function MarketplaceConnections() {
  const queryClient = useQueryClient();
  const fetchAccount = useServerFn(getEbayAccount);
  const startOAuth = useServerFn(startEbayOAuth);
  const disconnect = useServerFn(disconnectEbay);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ebay-account"],
    queryFn: () => fetchAccount(),
  });

  const [busy, setBusy] = useState(false);

  // Show success/error after returning from eBay callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ebay = params.get("ebay");
    if (!ebay) return;
    if (ebay === "connected") {
      toast.success("eBay connected");
    } else if (ebay === "error") {
      toast.error(`eBay connection failed: ${params.get("message") ?? "unknown error"}`);
    }
    // Clean URL
    const clean = window.location.pathname;
    window.history.replaceState({}, "", clean);
    refetch();
  }, [refetch]);

  const onConnect = async () => {
    setBusy(true);
    try {
      const { url } = await startOAuth();
      window.location.href = url;
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Failed to start OAuth");
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    try {
      await disconnect();
      await queryClient.invalidateQueries({ queryKey: ["ebay-account"] });
      toast.success("eBay disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  };

  const status = data?.status ?? "not_connected";
  const variant: "default" | "secondary" | "destructive" =
    status === "connected"
      ? "default"
      : status === "error"
        ? "destructive"
        : "secondary";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Marketplace Connections</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 border rounded-md p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">eBay</span>
              <Badge variant={variant}>
                {isLoading ? "…" : data?.connected ? "Connected" : status === "error" ? "Error" : "Not connected"}
              </Badge>
              {data?.environment && (
                <Badge variant="outline">{data.environment}</Badge>
              )}
            </div>
            {data?.connected && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                {data.accountName && <div>Account: {data.accountName}</div>}
                {data.externalAccountId && (
                  <div>User ID: {data.externalAccountId}</div>
                )}
                {data.connectedAt && (
                  <div>
                    Connected: {new Date(data.connectedAt).toLocaleString()}
                  </div>
                )}
                {data.scopes && data.scopes.length > 0 && (
                  <div className="break-all">
                    Scopes: {data.scopes.length}
                  </div>
                )}
              </div>
            )}
            {status === "error" && data?.errorMessage && (
              <div className="text-xs text-destructive">{data.errorMessage}</div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {data?.connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onDisconnect}
                disabled={busy}
              >
                Disconnect
              </Button>
            ) : (
              <Button size="sm" onClick={onConnect} disabled={busy}>
                Connect eBay
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
