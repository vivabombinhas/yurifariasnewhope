
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE public.product_status AS ENUM (
  'received','photographed','draft','ready_to_list','listed','sold','shipped','archived'
);
CREATE TYPE public.product_condition AS ENUM (
  'new','like_new','very_good','good','acceptable','for_parts'
);
CREATE TYPE public.marketplace AS ENUM (
  'ebay','etsy','facebook_marketplace','poshmark','depop'
);
CREATE TYPE public.listing_status AS ENUM (
  'draft','active','sold','ended','removed'
);

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area TEXT NOT NULL,
  shelf TEXT,
  box TEXT,
  label TEXT GENERATED ALWAYS AS (
    area || COALESCE(' / ' || shelf, '') || COALESCE(' / ' || box, '')
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (area, shelf, box)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all" ON public.locations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all" ON public.categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all" ON public.brands FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  condition public.product_condition,
  price_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  status public.product_status NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_status ON public.products(status);
CREATE INDEX idx_products_location ON public.products(location_id);
CREATE INDEX idx_products_brand ON public.products(brand_id);
CREATE INDEX idx_products_category ON public.products(category_id);
CREATE INDEX idx_products_title_trgm ON public.products USING GIN (title gin_trgm_ops);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE SEQUENCE IF NOT EXISTS public.products_sku_seq START 1000;
CREATE OR REPLACE FUNCTION public.tg_products_sku()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.sku IS NULL OR NEW.sku = '' THEN
    NEW.sku := 'SKU-' || LPAD(nextval('public.products_sku_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_products_sku BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_products_sku();

CREATE TABLE public.product_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  from_status public.product_status,
  to_status public.product_status NOT NULL,
  changed_by UUID,
  note TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_psh_product ON public.product_status_history(product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_status_history TO authenticated;
GRANT ALL ON public.product_status_history TO service_role;
ALTER TABLE public.product_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all" ON public.product_status_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tg_products_status_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.product_status_history(product_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.product_status_history(product_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_products_status_history_ins AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_products_status_history();
CREATE TRIGGER trg_products_status_history_upd AFTER UPDATE OF status ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_products_status_history();

CREATE TABLE public.product_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_cover BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_photos_product ON public.product_photos(product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_photos TO authenticated;
GRANT ALL ON public.product_photos TO service_role;
ALTER TABLE public.product_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all" ON public.product_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  marketplace public.marketplace NOT NULL,
  status public.listing_status NOT NULL DEFAULT 'draft',
  listing_url TEXT,
  listed_at TIMESTAMPTZ,
  sold_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, marketplace)
);
CREATE INDEX idx_ml_product ON public.marketplace_listings(product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_listings TO authenticated;
GRANT ALL ON public.marketplace_listings TO service_role;
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all" ON public.marketplace_listings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_ml_updated BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
