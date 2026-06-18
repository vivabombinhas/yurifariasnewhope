import { createFileRoute } from "@tanstack/react-router";

/**
 * Public image proxy for eBay InventoryItem image URLs.
 * eBay enforces ≤500 chars per URL and ≤3975 chars total — Supabase signed
 * URLs blow that budget. This endpoint serves photos from the private
 * `product-photos` bucket via a short, stable, public URL.
 *
 * GET /api/public/ebay/image/:photoId
 */
export const Route = createFileRoute("/api/public/ebay/image/$photoId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const photoId = params.photoId;
        if (!photoId || !/^[0-9a-f-]{36}$/i.test(photoId)) {
          return new Response("Invalid photo id", { status: 400 });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: photo, error } = await supabaseAdmin
          .from("product_photos")
          .select("storage_path")
          .eq("id", photoId)
          .maybeSingle();
        if (error || !photo) {
          return new Response("Not found", { status: 404 });
        }

        const { data: file, error: dErr } = await supabaseAdmin.storage
          .from("product-photos")
          .download(photo.storage_path);
        if (dErr || !file) {
          return new Response("File not found", { status: 404 });
        }

        const ext = photo.storage_path.split(".").pop()?.toLowerCase();
        const contentType =
          file.type && file.type !== "application/octet-stream"
            ? file.type
            : ext === "png"
              ? "image/png"
              : ext === "webp"
                ? "image/webp"
                : ext === "gif"
                  ? "image/gif"
                  : "image/jpeg";

        const buf = await file.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400, immutable",
          },
        });
      },
    },
  },
});
