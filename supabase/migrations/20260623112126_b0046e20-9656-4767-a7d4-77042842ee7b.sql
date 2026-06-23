
CREATE OR REPLACE FUNCTION public.set_vault_secret(_name text, _value text, _description text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM vault.create_secret(_value, _name, COALESCE(_description, ''));
  EXCEPTION WHEN unique_violation THEN
    -- Already exists; do nothing (vault.update_secret requires id which we cannot read).
    NULL;
  END;
END;
$$;
