import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw redirect({ to: "/auth" });
      return { user: data.user };
    } catch (e: any) {
      // Network / transient errors -> send to auth instead of crashing the SSR shell.
      if (e?.isRedirect) throw e;
      throw redirect({ to: "/auth" });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  errorComponent: AuthenticatedError,
  notFoundComponent: () => (
    <AppShell>
      <div className="p-6 text-center space-y-2">
        <h2 className="text-lg font-semibold">Page not found</h2>
        <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
      </div>
    </AppShell>
  ),
});

function AuthenticatedError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  console.error(error);
  return (
    <AppShell>
      <div className="p-6 text-center space-y-3 max-w-md mx-auto">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground break-words">
          {error?.message || "Unexpected error."}
        </p>
        <div className="flex gap-2 justify-center">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Try again
          </Button>
          <Button variant="outline" onClick={() => router.navigate({ to: "/" })}>
            Go home
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
