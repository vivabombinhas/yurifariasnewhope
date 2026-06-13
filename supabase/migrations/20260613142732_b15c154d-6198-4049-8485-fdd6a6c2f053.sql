CREATE TABLE public.ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  model text NOT NULL,
  raw jsonb NOT NULL,
  suggestion jsonb NOT NULL,
  accepted boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_suggestions_product_id_idx ON public.ai_suggestions(product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_suggestions TO authenticated;
GRANT ALL ON public.ai_suggestions TO service_role;

ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all" ON public.ai_suggestions FOR ALL TO authenticated USING (true) WITH CHECK (true);