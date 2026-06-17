ALTER TABLE public.marketplace_accounts
  RENAME COLUMN expires_at TO token_expires_at;

ALTER TABLE public.marketplace_accounts
  ADD COLUMN account_name text,
  ADD COLUMN environment text NOT NULL DEFAULT 'production',
  ADD COLUMN status text NOT NULL DEFAULT 'connected',
  ADD COLUMN connected_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_refresh_at timestamptz,
  ADD COLUMN error_message text;