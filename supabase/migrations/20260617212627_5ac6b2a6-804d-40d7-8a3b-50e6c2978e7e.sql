ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS external_listing_id text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_product_marketplace_key
  ON public.marketplace_listings (product_id, marketplace);