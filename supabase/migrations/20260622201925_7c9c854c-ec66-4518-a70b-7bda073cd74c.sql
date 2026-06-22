CREATE OR REPLACE FUNCTION public.record_marketplace_sale(_marketplace_account_id uuid, _marketplace text, _external_order_id text, _external_line_item_id text, _external_listing_id text, _sku text, _quantity integer, _order_created_at timestamp with time zone, _order_modified_at timestamp with time zone, _payment_status text, _fulfillment_status text, _processing_status text, _processing_error jsonb, _raw_order_redacted jsonb, _product_id uuid, _marketplace_listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _sale_id uuid;
  _product_marked boolean := false;
  _listing_marked boolean := false;
  _now timestamptz := now();
BEGIN
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

  -- publishing_jobs requires NOT NULL product_id; only audit when matched with a product.
  IF _product_id IS NOT NULL THEN
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
      'success',
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
  END IF;

  RETURN jsonb_build_object(
    'already_processed',   false,
    'sale_id',             _sale_id,
    'product_marked_sold', _product_marked,
    'listing_marked_sold', _listing_marked
  );
END;
$function$;