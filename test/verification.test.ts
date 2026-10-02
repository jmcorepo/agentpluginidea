import assert from "node:assert/strict";
import test from "node:test";
import {
  addressesMatch,
  isUsAddress,
  verifyQuoteContext,
} from "../src/verification.js";
import { fingerprint, quoteExpiry, rankComparison } from "../src/comparison.js";
import type { Comparison, Quote, RideRequest } from "../src/domain.js";
const request: RideRequest = {
  pickup: "123 Main Street, Chicago IL 60601",
  destination: "456 Oak Road, Chicago IL 60602",
  passengers: 2,
  serviceClass: "standard",
};
function quote(provider: "uber" | "lyft"): Quote {
  return {
    id: crypto.randomUUID(),
    provider,
    sector: "rides",
    status: "verified",
    verification: "automatic",
    source: "browser",
    label: provider === "uber" ? "UberX" : "Standard",
    totalCents: 2000,
    currency: "USD",
    capturedAt: new Date().toISOString(),
    expiresAt: quoteExpiry("rides"),
    etaMinutes: 20,
    benefits: [],
    warnings: [],
    evidence: "Provider fare",
    requestFingerprint: fingerprint("rides", request),
    observedContext: {
      kind: "rides",
      source: "provider_dom",
      pickup: request.pickup,
      destination: request.destination,
      serviceClass: "standard",
      category: provider === "uber" ? "UberX" : "Standard",
      capacity: 4,
      shared: false,
      evidence: "Resolved route and service card",
      currencyEvidence: "observed-us-addresses",
    },
  };
}
function comparison(quotes: Quote[]): Comparison {
  return {
    id: crypto.randomUUID(),
    mode: "automatic",
    sector: "rides",
    request,
    fingerprint: fingerprint("rides", request),
    quotes,
    warnings: [],
    createdAt: new Date().toISOString(),
    ranking: {
      cheapest: null,
      fastest: null,
      eligibleCount: 0,
      excludedCount: 0,
    },
  };
}
test("address matching allows punctuation and street suffixes but rejects a wrong branch or missing unit", () => {
  assert.equal(
    addressesMatch(request.pickup, "123 Main St., Chicago, IL 60601, USA"),
    true,
  );
  assert.equal(
    addressesMatch(request.pickup, "124 Main St., Chicago, IL 60601"),
    false,
  );
  assert.equal(
    addressesMatch("123 Main St Apt 2, Chicago IL 60601", request.pickup),
    false,
  );
  assert.equal(isUsAddress(request.pickup), true);
  assert.equal(isUsAddress("123 Main Street, Toronto ON M5V 1A1"), false);
  assert.equal(isUsAddress("123 Main Street"), false);
});
test("a correct fingerprint cannot validate a wrong observed route", () => {
  const q = quote("uber");
  assert.equal(verifyQuoteContext(q, request), null);
  if (q.observedContext?.kind === "rides")
    q.observedContext.destination = "999 Wrong Street, Chicago IL 60602";
  assert.match(verifyQuoteContext(q, request) ?? "", /route/);
  assert.equal(
    rankComparison(comparison([q, quote("lyft")])).ranking.cheapest,
    null,
  );
});
test("automatic rankings require independent context, freshness and at least two distinct providers", () => {
  const uber = quote("uber"),
    lyft = quote("lyft");
  lyft.totalCents = 1900;
  assert.equal(
    rankComparison(comparison([uber, lyft])).ranking.cheapest?.provider,
    "lyft",
  );
  assert.equal(
    rankComparison(comparison([uber, { ...lyft, etaMinutes: null }])).ranking
      .fastest,
    null,
  );
  assert.equal(
    rankComparison(comparison([uber, { ...uber, id: "duplicate" }])).ranking
      .cheapest,
    null,
  );
  assert.equal(
    rankComparison(comparison([uber, { ...lyft, source: "manual" }])).ranking
      .cheapest,
    null,
  );
  assert.equal(
    rankComparison(comparison([uber, { ...lyft, observedContext: undefined }]))
      .ranking.cheapest,
    null,
  );
  assert.equal(
    rankComparison(
      comparison([uber, { ...lyft, expiresAt: new Date(0).toISOString() }]),
    ).ranking.cheapest,
    null,
  );
});
