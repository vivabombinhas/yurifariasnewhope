CREATE TABLE public.marketplace_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace public.marketplace NOT NULL,
  external_account_id text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX marketplace_accounts_marketplace_external_idx
  ON public.marketplace_accounts (marketplace, external_account_id)
  WHERE external_account_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_accounts TO authenticated;
GRANT ALL ON public.marketplace_accounts TO service_role;

ALTER TABLE public.marketplace_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all" ON public.marketplace_accounts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.marketplace_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();