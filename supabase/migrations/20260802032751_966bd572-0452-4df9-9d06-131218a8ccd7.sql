CREATE TABLE IF NOT EXISTS public.ai_product_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 2 CHECK (version >= 2),
  status text NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('needs_review', 'ready', 'approved', 'failed')),
  model text NOT NULL,
  identification jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_product_analyses_product_created_idx
  ON public.ai_product_analyses(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_marketplace_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES public.ai_product_analyses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  marketplace public.marketplace NOT NULL,
  title text NOT NULL DEFAULT '',
  condition_text text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  shipping_text text NOT NULL DEFAULT '',
  listing_price_cents integer CHECK (listing_price_cents IS NULL OR listing_price_cents >= 0),
  minimum_offer_cents integer CHECK (minimum_offer_cents IS NULL OR minimum_offer_cents >= 0),
  buyer_shipping_cents integer CHECK (buyer_shipping_cents IS NULL OR buyer_shipping_cents >= 0),
  estimated_buyer_total_cents integer CHECK (estimated_buyer_total_cents IS NULL OR estimated_buyer_total_cents >= 0),
  price_confidence text NOT NULL DEFAULT 'estimate_only'
    CHECK (price_confidence IN ('high', 'medium', 'low', 'estimate_only', 'research_required')),
  pricing_basis text NOT NULL DEFAULT '',
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, marketplace)
);

CREATE INDEX IF NOT EXISTS ai_marketplace_drafts_product_idx
  ON public.ai_marketplace_drafts(product_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_product_analyses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_marketplace_drafts TO authenticated;
GRANT ALL ON public.ai_product_analyses TO service_role;
GRANT ALL ON public.ai_marketplace_drafts TO service_role;

ALTER TABLE public.ai_product_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_marketplace_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all" ON public.ai_product_analyses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all" ON public.ai_marketplace_drafts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ai_product_analyses_updated
  BEFORE UPDATE ON public.ai_product_analyses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_ai_marketplace_drafts_updated
  BEFORE UPDATE ON public.ai_marketplace_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();