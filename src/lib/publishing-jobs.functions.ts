import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const StatusFilter = z.enum(["all", "pending", "processing", "success", "error"]);

const Input = z.object({
  status: StatusFilter.default("all"),
  limit: z.number().int().min(1).max(200).default(100),
});

export const listPublishingJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("publishing_jobs")
      .select(
        "id, product_id, marketplace, action, status, attempt_count, last_error, processed_at, created_at, updated_at, product:products(title, sku)",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
