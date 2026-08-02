CREATE TABLE IF NOT EXISTS public.depop_taxonomy_product_types (
  department text NOT NULL,
  group_slug text NOT NULL,
  product_type text NOT NULL,
  source_snapshot text NOT NULL DEFAULT 'Depop Taxonomy Mapping updtd:02/12',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department, product_type)
);

CREATE TABLE IF NOT EXISTS public.depop_taxonomy_attributes (
  product_type text NOT NULL,
  attribute_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_type, attribute_id)
);

CREATE TABLE IF NOT EXISTS public.depop_taxonomy_attribute_values (
  product_type text NOT NULL,
  attribute_id text NOT NULL,
  attribute_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_type, attribute_id, attribute_value)
);

CREATE TABLE IF NOT EXISTS public.depop_taxonomy_sizes (
  country_code text NOT NULL DEFAULT 'US',
  product_type text NOT NULL,
  size_set_id integer NOT NULL,
  size_id integer NOT NULL,
  size_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_code, product_type, size_set_id, size_id)
);

ALTER TABLE public.depop_taxonomy_product_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depop_taxonomy_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depop_taxonomy_attribute_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depop_taxonomy_sizes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read Depop product types"
  ON public.depop_taxonomy_product_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users read Depop attributes"
  ON public.depop_taxonomy_attributes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users read Depop attribute values"
  ON public.depop_taxonomy_attribute_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users read Depop sizes"
  ON public.depop_taxonomy_sizes FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.depop_taxonomy_product_types TO authenticated;
GRANT SELECT ON public.depop_taxonomy_attributes TO authenticated;
GRANT SELECT ON public.depop_taxonomy_attribute_values TO authenticated;
GRANT SELECT ON public.depop_taxonomy_sizes TO authenticated;
GRANT ALL ON public.depop_taxonomy_product_types TO service_role;
GRANT ALL ON public.depop_taxonomy_attributes TO service_role;
GRANT ALL ON public.depop_taxonomy_attribute_values TO service_role;
GRANT ALL ON public.depop_taxonomy_sizes TO service_role;
