import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  console.error(error);
  return (
    <div className="p-6 text-center space-y-3 max-w-md mx-auto">
      <h2 className="text-lg font-semibold">This section failed to load</h2>
      <p className="text-sm text-muted-foreground break-words">
        {error?.message || "Unexpected error."}
      </p>
      <div className="flex gap-2 justify-center">
        <Button
          size="sm"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Try again
        </Button>
        <Button size="sm" variant="outline" onClick={() => router.navigate({ to: "/" })}>
          Go home
        </Button>
      </div>
    </div>
  );
}
