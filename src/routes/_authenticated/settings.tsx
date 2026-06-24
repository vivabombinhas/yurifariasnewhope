import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LANG_LABELS,
  SUPPORTED_LANGS,
  useI18n,
  type Lang,
} from "@/lib/i18n";
import { RouteError } from "@/components/RouteError";
import { MarketplaceConnections } from "@/components/MarketplaceConnections";
import { EbayOrdersSyncPanel } from "@/components/EbayOrdersSyncPanel";
import { EbayShippingOriginPanel } from "@/components/EbayShippingOriginPanel";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Inventory" }] }),
  component: SettingsPage,
  errorComponent: RouteError,
});

function SettingsPage() {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>

      <MarketplaceConnections />
      <EbayShippingOriginPanel />
      <EbayOrdersSyncPanel />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.language")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="lang">{t("settings.language")}</Label>
            <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
              <SelectTrigger id="lang" className="h-12 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LANG_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("settings.languageHelp")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
