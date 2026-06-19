-- 1. Add needs_condition_reselection flag
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS needs_condition_reselection boolean NOT NULL DEFAULT false;

-- 2. Canonical id->enum function (idempotent)
CREATE OR REPLACE FUNCTION public.ebay_condition_enum_for_id(_condition_id integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _condition_id
    WHEN 1000 THEN 'NEW'
    WHEN 1500 THEN 'NEW_OTHER'
    WHEN 1750 THEN 'NEW_WITH_DEFECTS'
    WHEN 2000 THEN 'CERTIFIED_REFURBISHED'
    WHEN 2010 THEN 'EXCELLENT_REFURBISHED'
    WHEN 2020 THEN 'VERY_GOOD_REFURBISHED'
    WHEN 2030 THEN 'GOOD_REFURBISHED'
    WHEN 2500 THEN 'SELLER_REFURBISHED'
    WHEN 2750 THEN 'LIKE_NEW'
    WHEN 2990 THEN 'PRE_OWNED_EXCELLENT'
    WHEN 3000 THEN 'USED_EXCELLENT'
    WHEN 3010 THEN 'USED_ACCEPTABLE'
    WHEN 4000 THEN 'USED_VERY_GOOD'
    WHEN 5000 THEN 'USED_GOOD'
    WHEN 6000 THEN 'USED_ACCEPTABLE'
    WHEN 7000 THEN 'FOR_PARTS_OR_NOT_WORKING'
    ELSE NULL
  END
$$;

-- 3. Sanitize inconsistent rows: clear condition fields and flag for reselection.
-- Uses CTE so the same rows are flagged and cleared atomically.
WITH inconsistent AS (
  SELECT id FROM public.products
  WHERE ebay_condition_id IS NOT NULL
    AND ebay_condition_enum IS NOT NULL
    AND public.ebay_condition_enum_for_id(ebay_condition_id) IS DISTINCT FROM ebay_condition_enum
)
UPDATE public.products p
SET ebay_condition_id = NULL,
    ebay_condition_enum = NULL,
    ebay_condition_name = NULL,
    needs_condition_reselection = true
FROM inconsistent i
WHERE p.id = i.id;

-- Also flag (without clearing) rows where only one of the two is set — same inconsistency class.
UPDATE public.products
SET ebay_condition_id = NULL,
    ebay_condition_enum = NULL,
    ebay_condition_name = NULL,
    needs_condition_reselection = true
WHERE (ebay_condition_id IS NULL) <> (ebay_condition_enum IS NULL);

-- 4. Drop prior constraint if present, then add fully-validated CHECK.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_ebay_condition_id_enum_match;

ALTER TABLE public.products
  ADD CONSTRAINT products_ebay_condition_id_enum_match
  CHECK (
    (ebay_condition_id IS NULL AND ebay_condition_enum IS NULL)
    OR public.ebay_condition_enum_for_id(ebay_condition_id) = ebay_condition_enum
  );