import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Boxes, LayoutDashboard, MapPin, Package, LogOut, Settings, Zap, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const NAV: Array<{
  to: string;
  labelKey: string;
  label?: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
}> = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, exact: true },
  { to: "/products", labelKey: "nav.products", icon: Package },
  { to: "/intake", labelKey: "nav.intake", icon: Zap },
  { to: "/locations", labelKey: "nav.locations", icon: MapPin },
  { to: "/publishing", labelKey: "nav.publishing", label: "Vendas", icon: Send },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const t = useT();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  function isActive(to: string, exact?: boolean) {
    return exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");
  }

  return (
    <div className="min-h-screen bg-muted/20 pb-20 md:pb-0 md:pl-56">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-56 flex-col border-r bg-background">
        <div className="flex items-center gap-2 px-4 h-14 border-b">
          <Boxes className="h-5 w-5" />
          <span className="font-semibold">{t("nav.appName")}</span>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as any}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive(item.to, item.exact)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {t(item.labelKey)}
              </Link>
            );
          })}
          <Link
            to="/settings"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive("/settings")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Settings className="h-4 w-4" />
            {t("nav.settings")}
          </Link>
        </nav>
        <div className="p-2 border-t">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> {t("nav.signOut")}
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-10 flex items-center justify-between h-14 border-b bg-background px-4">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5" />
          <span className="font-semibold">{t("nav.appName")}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild aria-label={t("nav.settings")}>
            <Link to="/settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label={t("nav.signOut")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="px-4 py-4 md:px-8 md:py-6 max-w-6xl mx-auto">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t bg-background">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to, item.exact);
          return (
            <Link
              key={item.to}
              to={item.to as any}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 text-xs",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
