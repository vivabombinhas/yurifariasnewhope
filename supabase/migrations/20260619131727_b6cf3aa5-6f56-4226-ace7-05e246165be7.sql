ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS last_failed_step text,
  ADD COLUMN IF NOT EXISTS last_error jsonb;

ALTER TABLE public.marketplace_accounts
  ADD COLUMN IF NOT EXISTS merchant_location_key text,
  ADD COLUMN IF NOT EXISTS business_policy_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS publishing_jobs_active_product_marketplace_key
  ON public.publishing_jobs (product_id, marketplace)
  WHERE status IN ('pending', 'processing');