
-- eBay Best Offer settings (global singleton) + per-product override columns
CREATE TABLE public.ebay_offer_settings (
  id text PRIMARY KEY DEFAULT 'global',
  allow_offers boolean NOT NULL DEFAULT true,
  minimum_mode text NOT NULL DEFAULT 'percentage' CHECK (minimum_mode IN ('off','percentage','fixed')),
  minimum_percentage numeric(5,2),
  minimum_amount_cents integer,
  auto_accept_mode text NOT NULL DEFAULT 'off' CHECK (auto_accept_mode IN ('off','percentage','fixed')),
  auto_accept_percentage numeric(5,2),
  auto_accept_amount_cents integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ebay_offer_min_pct_pos CHECK (minimum_percentage IS NULL OR (minimum_percentage > 0 AND minimum_percentage < 100)),
  CONSTRAINT ebay_offer_min_amt_pos CHECK (minimum_amount_cents IS NULL OR minimum_amount_cents > 0),
  CONSTRAINT ebay_offer_acc_pct_pos CHECK (auto_accept_percentage IS NULL OR (auto_accept_percentage > 0 AND auto_accept_percentage <= 100)),
  CONSTRAINT ebay_offer_acc_amt_pos CHECK (auto_accept_amount_cents IS NULL OR auto_accept_amount_cents > 0)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebay_offer_settings TO authenticated;
GRANT ALL ON public.ebay_offer_settings TO service_role;

ALTER TABLE public.ebay_offer_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all" ON public.ebay_offer_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ebay_offer_settings_updated
  BEFORE UPDATE ON public.ebay_offer_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed the singleton row with recommended defaults
INSERT INTO public.ebay_offer_settings (id, allow_offers, minimum_mode, minimum_percentage, auto_accept_mode)
VALUES ('global', true, 'percentage', 70, 'off')
ON CONFLICT (id) DO NOTHING;

-- Per-product override columns
ALTER TABLE public.products
  ADD COLUMN ebay_offer_override boolean NOT NULL DEFAULT false,
  ADD COLUMN ebay_offer_allow boolean,
  ADD COLUMN ebay_offer_minimum_mode text CHECK (ebay_offer_minimum_mode IS NULL OR ebay_offer_minimum_mode IN ('off','percentage','fixed')),
  ADD COLUMN ebay_offer_minimum_percentage numeric(5,2) CHECK (ebay_offer_minimum_percentage IS NULL OR (ebay_offer_minimum_percentage > 0 AND ebay_offer_minimum_percentage < 100)),
  ADD COLUMN ebay_offer_minimum_amount_cents integer CHECK (ebay_offer_minimum_amount_cents IS NULL OR ebay_offer_minimum_amount_cents > 0),
  ADD COLUMN ebay_offer_auto_accept_mode text CHECK (ebay_offer_auto_accept_mode IS NULL OR ebay_offer_auto_accept_mode IN ('off','percentage','fixed')),
  ADD COLUMN ebay_offer_auto_accept_percentage numeric(5,2) CHECK (ebay_offer_auto_accept_percentage IS NULL OR (ebay_offer_auto_accept_percentage > 0 AND ebay_offer_auto_accept_percentage <= 100)),
  ADD COLUMN ebay_offer_auto_accept_amount_cents integer CHECK (ebay_offer_auto_accept_amount_cents IS NULL OR ebay_offer_auto_accept_amount_cents > 0);
