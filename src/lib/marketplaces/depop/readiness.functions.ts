import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDepopReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getDepopConfig } = await import("./client.server");
    const config = getDepopConfig();
    return {
      configured: !!config.apiKey,
      environment: config.environment,
      taxonomySource:
        "https://docs.google.com/spreadsheets/d/1ADIVif8wevUHcMuo2QK5VEKHRYkwKHHbukOxEjUXgeo/edit",
      mode: config.apiKey ? ("api_ready" as const) : ("assisted" as const),
    };
  });
