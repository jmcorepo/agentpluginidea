import type { FoodRequest, Quote, RideRequest } from "./domain.js";

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Only formatting and common street suffixes are equivalent; ambiguous places must be resolved. */
export function addressesMatch(expected: string, observed: string): boolean {
  const abbreviations: Record<string, string> = {
    street: "st",
    avenue: "ave",
    road: "rd",
    boulevard: "blvd",
    drive: "dr",
    lane: "ln",
    court: "ct",
    place: "pl",
    parkway: "pkwy",
    highway: "hwy",
    apartment: "apt",
    suite: "ste",
  };
  const normalize = (value: string) =>
    normalizeText(value)
      .replace(/\b(?:united states(?: of america)?|usa|us)$/, "")
      .trim()
      .split(" ")
      .map((word) => abbreviations[word] ?? word)
      .join(" ");
  return Boolean(
    expected.trim() &&
    observed.trim() &&
    normalize(expected) === normalize(observed),
  );
}

export function isUsAddress(value: string): boolean {
  const states =
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(
      " ",
    );
  const normalized = normalizeText(value);
  const match = normalized.match(
    /\b([a-z]{2})\s+(\d{5})(?:\s+\d{4})?(?:\s+(?:united states(?: of america)?|usa|us))?$/,
  );
  return Boolean(match && states.includes(match[1]!.toUpperCase()));
}

export function verifyQuoteContext(
  quote: Quote,
  request: RideRequest | FoodRequest,
): string | null {
  const seen = quote.observedContext;
  if (
    !seen ||
    !["provider_dom", "provider_api"].includes(seen.source) ||
    !seen.evidence.trim()
  )
    return "Provider request context was not independently observed.";
  if (!["USD", "US$", "observed-us-addresses"].includes(seen.currencyEvidence))
    return "Provider USD currency context was not independently established.";
  if (quote.sector === "rides") {
    if (seen.kind !== "rides" || !("pickup" in request))
      return "Provider returned a different comparison category.";
    if (
      !addressesMatch(request.pickup, seen.pickup) ||
      !addressesMatch(request.destination, seen.destination)
    )
      return "Provider route does not match the requested pickup and destination.";
    if (
      seen.currencyEvidence === "observed-us-addresses" &&
      (!isUsAddress(seen.pickup) || !isUsAddress(seen.destination))
    )
      return "Provider geography does not establish a USD quote.";
    if (
      seen.serviceClass !== (request.serviceClass ?? "standard") ||
      seen.shared
    )
      return "Provider service does not match a standard, non-shared ride.";
    const labels =
      quote.provider === "uber"
        ? ["uberx"]
        : quote.provider === "lyft"
          ? ["lyft", "standard"]
          : [];
    if (!labels.includes(normalizeText(seen.category)))
      return "Provider ride category was not recognized as equivalent.";
    if (
      !Number.isInteger(seen.capacity) ||
      seen.capacity < request.passengers ||
      seen.capacity > 8
    )
      return "Provider vehicle capacity is unknown or insufficient.";
    return null;
  }
  if (seen.kind !== "eats" || !("items" in request))
    return "Provider returned a different comparison category.";
  if (
    !request.restaurantAddress ||
    !addressesMatch(request.restaurantAddress, seen.restaurantAddress) ||
    normalizeText(request.restaurant) !== normalizeText(seen.restaurant)
  )
    return "Provider restaurant branch does not match the requested branch.";
  if (!addressesMatch(request.address, seen.address))
    return "Provider delivery address does not match the request.";
  if (
    seen.currencyEvidence === "observed-us-addresses" &&
    (!isUsAddress(seen.restaurantAddress) || !isUsAddress(seen.address))
  )
    return "Provider geography does not establish a USD quote.";
  if (
    seen.deliverySpeed !== (request.deliverySpeed ?? "standard") ||
    seen.tipCents !== request.tipCents
  )
    return "Provider delivery option or tip does not match the request.";
  const signature = (item: FoodRequest["items"][number]) =>
    JSON.stringify({
      name: normalizeText(item.name),
      quantity: item.quantity,
      notes: normalizeText(item.notes ?? ""),
      modifiers: (item.modifiers ?? [])
        .map((m) => ({
          group: normalizeText(m.group),
          option: normalizeText(m.option),
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    });
  const expected = request.items.map(signature).sort(),
    actual = seen.items.map(signature).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    return "Provider basket differs in items, quantities, modifiers, or instructions.";
  return null;
}
