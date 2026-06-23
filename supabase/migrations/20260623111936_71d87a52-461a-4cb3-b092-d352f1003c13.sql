
CREATE OR REPLACE FUNCTION public.set_vault_secret(_name text, _value text, _description text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _existing_id uuid;
BEGIN
  SELECT id INTO _existing_id FROM vault.secrets WHERE name = _name LIMIT 1;
  IF _existing_id IS NULL THEN
    PERFORM vault.create_secret(_value, _name, COALESCE(_description, ''));
  ELSE
    UPDATE vault.secrets
       SET secret = _value,
           description = COALESCE(_description, description)
     WHERE id = _existing_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_vault_secret(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_vault_secret(text, text, text) TO service_role;
