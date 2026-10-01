import { createHash } from "node:crypto";
import { verifyQuoteContext } from "./verification.js";
import type {
  Comparison,
  FoodRequest,
  Quote,
  RideRequest,
  Sector,
} from "./domain.js";

export function fingerprint(
  sector: Sector,
  request: RideRequest | FoodRequest,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ sector, request }))
    .digest("hex");
}

export function rankComparison(
  comparison: Comparison,
  now = Date.now(),
): Comparison {
  const eligible = comparison.quotes.filter(
    (q) =>
      (comparison.mode !== "automatic" ||
        (q.verification === "automatic" &&
          q.source !== "manual" &&
          verifyQuoteContext(q, comparison.request) === null)) &&
      q.status === "verified" &&
      q.currency === "USD" &&
      q.sector === comparison.sector &&
      q.requestFingerprint === comparison.fingerprint &&
      q.totalCents !== null &&
      Number.isSafeInteger(q.totalCents) &&
      q.totalCents >= 0 &&
      q.expiresAt !== null &&
      Number.isFinite(Date.parse(q.expiresAt)) &&
      Date.parse(q.expiresAt) > now,
  );
  const comparable =
    new Set(eligible.map((q) => q.provider)).size >= 2 ||
    comparison.mode !== "automatic";
  const cheapest =
    [...(comparable ? eligible : [])].sort(
      (a, b) => a.totalCents! - b.totalCents! || a.id.localeCompare(b.id),
    )[0] ?? null;
  const etaEligible = eligible.filter(
    (q) =>
      q.etaMinutes !== null &&
      Number.isFinite(q.etaMinutes) &&
      q.etaMinutes >= 0,
  );
  const comparableEta =
    new Set(etaEligible.map((q) => q.provider)).size >= 2 ||
    comparison.mode !== "automatic";
  const fastest =
    (comparableEta ? etaEligible : []).sort(
      (a, b) => a.etaMinutes! - b.etaMinutes! || a.totalCents! - b.totalCents!,
    )[0] ?? null;
  return {
    ...comparison,
    ranking: {
      cheapest,
      fastest,
      eligibleCount: eligible.length,
      excludedCount: comparison.quotes.length - eligible.length,
    },
  };
}

export function quoteExpiry(sector: Sector, now = Date.now()): string {
  return new Date(now + (sector === "rides" ? 5 : 15) * 60_000).toISOString();
}

export function confirmQuote(
  comparison: Comparison,
  id: string,
  now = Date.now(),
): Comparison {
  const quote = comparison.quotes.find((q) => q.id === id);
  if (!quote) throw new Error("Quote not found.");
  if (quote.status === "unavailable" || quote.totalCents === null)
    throw new Error("This quote has no usable price. Capture a new quote.");
  if (quote.requestFingerprint !== comparison.fingerprint)
    throw new Error("The quote belongs to a different request.");
  if (
    !quote.expiresAt ||
    Date.parse(quote.expiresAt) <= now ||
    !Number.isFinite(Date.parse(quote.expiresAt))
  ) {
    throw new Error("This quote has expired. Capture a fresh comparison.");
  }
  return rankComparison(
    {
      ...comparison,
      quotes: comparison.quotes.map((q) =>
        q.id === id ? { ...q, status: "verified" as const } : q,
      ),
    },
    now,
  );
}

export function unavailableQuote(
  provider: Quote["provider"],
  sector: Sector,
  requestFingerprint: string,
  error: string,
): Quote {
  return {
    id: crypto.randomUUID(),
    provider,
    sector,
    status: "unavailable",
    source: "browser",
    label: "Quote unavailable",
    totalCents: null,
    currency: "USD",
    capturedAt: new Date().toISOString(),
    expiresAt: null,
    etaMinutes: null,
    benefits: [],
    warnings: [],
    evidence: "",
    requestFingerprint,
    error,
  };
}
