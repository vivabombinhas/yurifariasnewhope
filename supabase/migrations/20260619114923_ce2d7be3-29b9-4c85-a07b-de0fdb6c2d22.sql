ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ebay_condition_id integer,
  ADD COLUMN IF NOT EXISTS ebay_condition_enum text,
  ADD COLUMN IF NOT EXISTS ebay_condition_name text;