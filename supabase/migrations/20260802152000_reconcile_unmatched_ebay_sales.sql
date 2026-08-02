CREATE OR REPLACE FUNCTION public.reconcile_ebay_sale(
  _sale_id uuid,
  _product_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _sale public.marketplace_sales%ROWTYPE;
  _listing public.marketplace_listings%ROWTYPE;
  _now timestamptz := now();
BEGIN
  SELECT * INTO _sale
  FROM public.marketplace_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF _sale.marketplace <> 'ebay' THEN RAISE EXCEPTION 'Sale is not from eBay'; END IF;
  IF _sale.processing_status NOT IN ('unmatched', 'error') THEN
    RAISE EXCEPTION 'Sale has already been resolved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = _product_id) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  SELECT * INTO _listing
  FROM public.marketplace_listings
  WHERE product_id = _product_id AND marketplace = 'ebay'
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.marketplace_listings
    SET status = 'sold',
        sold_at = COALESCE(sold_at, _sale.order_created_at, _now),
        external_order_id = _sale.external_order_id,
        external_line_item_id = _sale.external_line_item_id,
        external_listing_id = COALESCE(external_listing_id, _sale.external_listing_id),
        listing_url = COALESCE(
          listing_url,
          CASE WHEN _sale.external_listing_id IS NOT NULL
            THEN 'https://www.ebay.com/itm/' || _sale.external_listing_id
            ELSE NULL END
        ),
        error_message = NULL,
        last_failed_step = NULL,
        provider_metadata = COALESCE(provider_metadata, '{}'::jsonb) || jsonb_build_object(
          'reconciledSaleId', _sale.id,
          'reconciledAt', _now,
          'reconciledSku', _sale.sku,
          'reconciledExternalListingId', _sale.external_listing_id
        ),
        updated_at = _now
    WHERE id = _listing.id;
  ELSE
    INSERT INTO public.marketplace_listings (
      product_id, marketplace, status, sold_at, external_order_id,
      external_line_item_id, external_listing_id, listing_url, provider_metadata
    ) VALUES (
      _product_id, 'ebay', 'sold', COALESCE(_sale.order_created_at, _now),
      _sale.external_order_id, _sale.external_line_item_id, _sale.external_listing_id,
      CASE WHEN _sale.external_listing_id IS NOT NULL
        THEN 'https://www.ebay.com/itm/' || _sale.external_listing_id ELSE NULL END,
      jsonb_build_object(
        'reconciledSaleId', _sale.id,
        'reconciledAt', _now,
        'reconciledSku', _sale.sku,
        'reconciledExternalListingId', _sale.external_listing_id
      )
    ) RETURNING * INTO _listing;
  END IF;

  UPDATE public.products
  SET status = 'sold', updated_at = _now
  WHERE id = _product_id;

  UPDATE public.marketplace_sales
  SET product_id = _product_id,
      marketplace_listing_id = _listing.id,
      processing_status = 'matched',
      processing_error = NULL,
      matched_at = _now,
      processed_at = _now
  WHERE id = _sale_id;

  RETURN jsonb_build_object('ok', true, 'listing_id', _listing.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_ebay_sale(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ebay_sale(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ignore_unmatched_ebay_sale(
  _sale_id uuid,
  _reason text DEFAULT 'old_or_external_listing'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.marketplace_sales
  SET processing_status = 'ignored',
      processing_error = jsonb_build_object('reason', COALESCE(NULLIF(_reason, ''), 'old_or_external_listing')),
      processed_at = now()
  WHERE id = _sale_id
    AND marketplace = 'ebay'
    AND processing_status IN ('unmatched', 'error');
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found or already resolved'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.ignore_unmatched_ebay_sale(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ignore_unmatched_ebay_sale(uuid, text) TO service_role;
