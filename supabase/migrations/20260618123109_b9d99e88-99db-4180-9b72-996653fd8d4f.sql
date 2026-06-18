ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ebay_category_id text,
  ADD COLUMN IF NOT EXISTS ebay_category_name text,
  ADD COLUMN IF NOT EXISTS ebay_category_confidence real,
  ADD COLUMN IF NOT EXISTS ebay_category_source text;