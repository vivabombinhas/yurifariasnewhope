CREATE TABLE public.publishing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  marketplace text NOT NULL,
  action text NOT NULL CHECK (action IN ('publish','update','close')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','success','error')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  payload jsonb,
  result jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.publishing_jobs TO authenticated;
GRANT ALL ON public.publishing_jobs TO service_role;

ALTER TABLE public.publishing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users manage publishing jobs"
  ON public.publishing_jobs FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX idx_publishing_jobs_status ON public.publishing_jobs(status, created_at DESC);
CREATE INDEX idx_publishing_jobs_product ON public.publishing_jobs(product_id);

CREATE TRIGGER trg_publishing_jobs_updated_at
  BEFORE UPDATE ON public.publishing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();