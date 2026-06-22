
-- =========================================================================
-- 1. marketplace_accounts: novas colunas
-- =========================================================================
ALTER TABLE public.marketplace_accounts
  ADD COLUMN IF NOT EXISTS last_orders_sync_at         timestamptz,
  ADD COLUMN IF NOT EXISTS last_orders_sync_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_orders_sync_status     text,
  ADD COLUMN IF NOT EXISTS last_orders_sync_error      jsonb,
  ADD COLUMN IF NOT EXISTS orders_sync_lock_at         timestamptz;

-- =========================================================================
-- 2. marketplace_listings: novas colunas
-- =========================================================================
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS external_order_id     text,
  ADD COLUMN IF NOT EXISTS external_line_item_id text;
-- sold_at já existe.

-- =========================================================================
-- 3. marketplace_sales (tabela nova)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.marketplace_sales (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_account_id   uuid NOT NULL REFERENCES public.marketplace_accounts(id) ON DELETE CASCADE,
  marketplace_listing_id   uuid REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
  product_id               uuid REFERENCES public.products(id) ON DELETE SET NULL,
  marketplace              text NOT NULL,
  external_order_id        text NOT NULL,
  external_line_item_id    text NOT NULL,
  external_listing_id      text,
  sku                      text,
  quantity                 integer,
  order_created_at         timestamptz,
  order_modified_at        timestamptz,
  payment_status           text,
  fulfillment_status       text,
  processing_status        text NOT NULL DEFAULT 'matched',
  processing_error         jsonb,
  matched_at               timestamptz,
  raw_order_redacted       jsonb,
  processed_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_sales_unique_line_item
    UNIQUE (marketplace_account_id, external_order_id, external_line_item_id),
  CONSTRAINT marketplace_sales_processing_status_chk
    CHECK (processing_status IN ('matched','unmatched','error'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_sales_account
  ON public.marketplace_sales(marketplace_account_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_sales_status
  ON public.marketplace_sales(processing_status);
CREATE INDEX IF NOT EXISTS idx_marketplace_sales_product
  ON public.marketplace_sales(product_id);

-- GRANTs: somente service_role acessa diretamente. Frontend usa server function.
GRANT ALL ON public.marketplace_sales TO service_role;

ALTER TABLE public.marketplace_sales ENABLE ROW LEVEL SECURITY;

-- Sem policies para anon/authenticated → bloqueia acesso direto via Data API.
-- service_role bypassa RLS por definição.

-- =========================================================================
-- 4. Funções SECURITY DEFINER — somente service_role pode executar
-- =========================================================================

-- ----- Lock por conta (TTL ~10min) ---------------------------------------
CREATE OR REPLACE FUNCTION public.try_acquire_orders_sync_lock(
  _account_id  uuid,
  _ttl_seconds integer DEFAULT 600
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _acquired boolean := false;
BEGIN
  UPDATE public.marketplace_accounts
     SET orders_sync_lock_at = now()
   WHERE id = _account_id
     AND (orders_sync_lock_at IS NULL
          OR orders_sync_lock_at < now() - make_interval(secs => _ttl_seconds))
  RETURNING true INTO _acquired;
  RETURN COALESCE(_acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_orders_sync_lock(_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.marketplace_accounts
     SET orders_sync_lock_at = NULL
   WHERE id = _account_id;
END;
$$;

-- ----- Registro atômico de venda -----------------------------------------
-- Retorna jsonb: { already_processed, sale_id, product_marked_sold, listing_marked_sold }
CREATE OR REPLACE FUNCTION public.record_marketplace_sale(
  _marketplace_account_id uuid,
  _marketplace            text,
  _external_order_id      text,
  _external_line_item_id  text,
  _external_listing_id    text,
  _sku                    text,
  _quantity               integer,
  _order_created_at       timestamptz,
  _order_modified_at      timestamptz,
  _payment_status         text,
  _fulfillment_status     text,
  _processing_status      text,
  _processing_error       jsonb,
  _raw_order_redacted     jsonb,
  _product_id             uuid,
  _marketplace_listing_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _sale_id uuid;
  _product_marked boolean := false;
  _listing_marked boolean := false;
  _now timestamptz := now();
BEGIN
  -- Insere venda; conflito = já processada
  INSERT INTO public.marketplace_sales (
    marketplace_account_id, marketplace_listing_id, product_id, marketplace,
    external_order_id, external_line_item_id, external_listing_id, sku, quantity,
    order_created_at, order_modified_at, payment_status, fulfillment_status,
    processing_status, processing_error, matched_at, raw_order_redacted
  ) VALUES (
    _marketplace_account_id, _marketplace_listing_id, _product_id, _marketplace,
    _external_order_id, _external_line_item_id, _external_listing_id, _sku, _quantity,
    _order_created_at, _order_modified_at, _payment_status, _fulfillment_status,
    _processing_status, _processing_error,
    CASE WHEN _processing_status = 'matched' THEN _now ELSE NULL END,
    _raw_order_redacted
  )
  ON CONFLICT (marketplace_account_id, external_order_id, external_line_item_id) DO NOTHING
  RETURNING id INTO _sale_id;

  IF _sale_id IS NULL THEN
    RETURN jsonb_build_object('already_processed', true);
  END IF;

  -- Para matched + qty=1: marcar produto e listing como sold
  IF _processing_status = 'matched'
     AND _product_id IS NOT NULL
     AND _marketplace_listing_id IS NOT NULL
     AND COALESCE(_quantity, 1) = 1 THEN

    UPDATE public.marketplace_listings
       SET status = 'sold'::public.listing_status,
           sold_at = COALESCE(sold_at, _now),
           external_order_id = _external_order_id,
           external_line_item_id = _external_line_item_id,
           updated_at = _now
     WHERE id = _marketplace_listing_id
       AND status <> 'sold'::public.listing_status;
    GET DIAGNOSTICS _listing_marked = ROW_COUNT;

    UPDATE public.products
       SET status = 'sold'::public.product_status,
           updated_at = _now
     WHERE id = _product_id
       AND status <> 'sold'::public.product_status;
    GET DIAGNOSTICS _product_marked = ROW_COUNT;
  END IF;

  -- Audit log em publishing_jobs
  INSERT INTO public.publishing_jobs (
    product_id, marketplace, action, status, payload, result, processed_at
  ) VALUES (
    _product_id,
    _marketplace,
    CASE _processing_status
      WHEN 'matched'   THEN 'sync_sale'
      WHEN 'unmatched' THEN 'sync_sale_unmatched'
      ELSE 'sync_sale_error'
    END,
    CASE _processing_status
      WHEN 'matched' THEN 'success'
      ELSE 'success'
    END,
    jsonb_build_object(
      'orderId',     _external_order_id,
      'lineItemId',  _external_line_item_id,
      'sku',         _sku,
      'legacyItemId',_external_listing_id,
      'quantity',    _quantity
    ),
    jsonb_build_object(
      'severity',           CASE _processing_status WHEN 'matched' THEN 'info' ELSE 'warning' END,
      'processing_status',  _processing_status,
      'product_marked_sold',_product_marked,
      'listing_marked_sold',_listing_marked,
      'sale_id',            _sale_id
    ),
    _now
  );

  RETURN jsonb_build_object(
    'already_processed',   false,
    'sale_id',             _sale_id,
    'product_marked_sold', _product_marked,
    'listing_marked_sold', _listing_marked
  );
END;
$$;

-- Revogar execução de papéis públicos e conceder apenas a service_role
REVOKE ALL ON FUNCTION public.try_acquire_orders_sync_lock(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_orders_sync_lock(uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_marketplace_sale(
  uuid, text, text, text, text, text, integer,
  timestamptz, timestamptz, text, text, text, jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.try_acquire_orders_sync_lock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_orders_sync_lock(uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION public.record_marketplace_sale(
  uuid, text, text, text, text, text, integer,
  timestamptz, timestamptz, text, text, text, jsonb, jsonb, uuid, uuid
) TO service_role;
