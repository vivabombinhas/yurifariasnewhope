import assert from "node:assert/strict";
import test from "node:test";
import { normalizeListingUrl } from "./listing-url";

test("normalizes a Poshmark listing and removes tracking parameters", () => {
  assert.deepEqual(
    normalizeListingUrl(
      "poshmark",
      "https://www.poshmark.com/listing/Vintage-Jacket-ABC123?utm_source=share",
    ),
    {
      url: "https://poshmark.com/listing/Vintage-Jacket-ABC123",
      externalListingId: "Vintage-Jacket-ABC123",
    },
  );
});

test("normalizes a Depop product URL", () => {
  assert.deepEqual(
    normalizeListingUrl("depop", "https://www.depop.com/products/seller-blue-jacket/"),
    {
      url: "https://depop.com/products/seller-blue-jacket",
      externalListingId: "seller-blue-jacket",
    },
  );
});

test("rejects a URL from the wrong marketplace", () => {
  assert.throws(
    () => normalizeListingUrl("poshmark", "https://depop.com/products/seller-blue-jacket"),
    /valid Poshmark URL/,
  );
});

test("rejects profile and home page URLs", () => {
  assert.throws(() => normalizeListingUrl("depop", "https://depop.com/seller"), /product listing/);
});
