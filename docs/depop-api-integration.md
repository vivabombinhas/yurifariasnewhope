# Depop Selling API integration

Official sources:

- API: https://partnerapi.depop.com/api-docs/
- Taxonomy snapshot: https://docs.google.com/spreadsheets/d/1ADIVif8wevUHcMuo2QK5VEKHRYkwKHHbukOxEjUXgeo/edit

## Secrets

- `DEPOP_API_KEY`: official Testing or Production API key issued by Depop.
- `DEPOP_ENV`: `testing` (default) or `production`.

Never store the key in the repository or expose it through a `VITE_` variable. Configure it as a server secret in Lovable.

## Prepared behavior

- Without a key, Depop remains in assisted mode.
- With a key, cross-channel sales can call the official `mark-as-sold` endpoint by internal SKU.
- Taxonomy tables are ready for the official department/product type, conditional attribute, attribute value and US size mappings.
- Automatic publishing must remain disabled until the official taxonomy snapshot has been imported and a Testing API key has passed sandbox validation.

## Activation checklist

1. Configure `DEPOP_API_KEY` and `DEPOP_ENV=testing`.
2. Import the official taxonomy snapshot into the prepared tables.
3. Validate seller address and shipping options with the Testing API.
4. Test create, update, mark-as-sold and order webhook flows in staging.
5. Request/enable production credentials and set `DEPOP_ENV=production`.
