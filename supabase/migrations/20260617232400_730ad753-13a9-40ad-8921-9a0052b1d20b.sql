ALTER TABLE public.products
  ADD COLUMN item_specifics jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN condition_grade text,
  ADD COLUMN condition_notes text,
  ADD COLUMN shipping_notes text;