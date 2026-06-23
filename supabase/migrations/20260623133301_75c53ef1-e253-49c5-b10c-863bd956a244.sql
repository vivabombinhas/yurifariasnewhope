DO $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name='EBAY_ORDER_SYNC_URL';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='EBAY_ORDER_SYNC_SECRET';
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_request_id;
  RAISE NOTICE 'request_id=%', v_request_id;
END $$;

-- Reactivate cron
SELECT cron.alter_job(1, active := true);