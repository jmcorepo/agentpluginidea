import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { captureRides, isAllowedRideUrl, parseRideTiming, parseVisibleRideFares } from '../src/providers/rides.js';

test('extracts separately labeled Uber fares, preserves evidence and exact cents', () => {
  const parsed = parseVisibleRideFares('uber', 'Choose a ride\nUberX\n4 seats\n$17.08\nComfort\n$22.50', 'USD');
  assert.deepEqual(parsed.fares.map(({ label, totalCents }) => ({ label, totalCents })), [
    { label: 'UberX', totalCents: 1708 }, { label: 'Comfort', totalCents: 2250 },
  ]);
  assert.equal(parsed.fares[0]?.evidence, 'UberX\n4 seats\n$17.08');
});

test('accepts explicit Lyft categories with integer, fractional and comma-formatted prices', () => {
  const parsed = parseVisibleRideFares('lyft', 'Wait & Save $12\nExtra Comfort USD $18.5\nBlack\n$1,025.09');
  assert.deepEqual(parsed.fares.map(fare => fare.totalCents), [1200, 1850, 102509]);
});

test('never selects a fare from ranges, crossed-out totals, malformed prices, or unit prices', () => {
  for (const price of ['$12–$18', '$12–18', '$12 to 18', '$12+', '$20\n$15', '$12.999', '$12.', '$ 12.00', 'from $12', 'about $12', '~$12', '$2 per mile', '$2/mile', '$0']) {
    assert.equal(parseVisibleRideFares('uber', `UberX\n${price}`, 'USD').fares.length, 0, price);
  }
});

test('rejects foreign currencies and ignores unlabelled dollar values', () => {
  for (const text of ['UberX\nCA$12', 'UberX\n$12 CAD', 'UberX\n€12', 'Lyft\n$12 AUD']) {
    assert.equal(parseVisibleRideFares(text.includes('Lyft') ? 'lyft' : 'uber', text, 'USD').fares.length, 0);
  }
  assert.equal(parseVisibleRideFares('uber', 'Your credit\n$25\nRide with us', 'USD').fares.length, 0);
  assert.equal(parseVisibleRideFares('uber', 'UberX\nNo cars available').fares.length, 0);
  assert.equal(parseVisibleRideFares('uber', 'UberX\nNo cars available\nAccount credit\n$25', 'USD').fares.length, 0);
});

test('origin validation disallows impersonators, other provider hosts, and insecure pages', () => {
  assert.equal(isAllowedRideUrl('uber', 'https://m.uber.com/go'), true);
  assert.equal(isAllowedRideUrl('uber', 'https://nested.riders.uber.com/go'), true);
  assert.equal(isAllowedRideUrl('lyft', 'https://ride.lyft.com/'), true);
  assert.equal(isAllowedRideUrl('lyft', 'https://nested.ride.lyft.com/'), true);
  for (const url of ['http://m.uber.com', 'https://m.uber.com.evil.test', 'https://notuber.com', 'https://uber.comevil.test', 'https://ride.lyft.com', 'https://accounts.google.com', 'https://appleid.apple.com', 'https://user:password@m.uber.com', 'https://m.uber.com:444']) {
    assert.equal(isAllowedRideUrl('uber', url), false, url);
  }
});

function fakePage(url: string, text: string): Page {
  return {
    url: () => url,
    locator: (selector: string) => {
      assert.equal(selector, 'body');
      return { innerText: async () => text };
    },
  } as unknown as Page;
}
const request = { pickup: '123 Main St', destination: 'Airport', passengers: 2 };

test('capture is provisional, uses actual timestamps and retains request identity', async () => {
  const before = Date.now();
  const result = await captureRides('uber', {
    page: fakePage('https://m.uber.com/go?token=secret#private', 'UberX\n5 min away\n$21.49'),
    fingerprint: 'exact-request-fingerprint',
    expectedCurrency: 'USD',
  }, request);
  const quote = result.quotes[0]!;
  assert.equal(quote.status, 'needs_confirmation');
  assert.equal(quote.totalCents, 2149);
  assert.equal(quote.etaMinutes, null); // Pickup wait does not establish arrival time.
  assert.equal(quote.expiresAt, null);
  assert.equal(quote.requestFingerprint, 'exact-request-fingerprint');
  assert.equal(quote.checkoutUrl, 'https://m.uber.com/go');
  assert.match(quote.id, /^[0-9a-f-]{36}$/);
  assert.ok(Date.parse(quote.capturedAt) >= before && Date.parse(quote.capturedAt) <= Date.now());
  assert.ok(quote.warnings.some(warning => warning.includes('2 passenger')));
  assert.ok(quote.warnings.some(warning => warning.includes('expiry is unknown')));
  assert.ok(quote.warnings.includes('USD assumed for U.S. pilot; confirm currency on the provider page.'));
});

test('plain dollar signs need explicit currency context; foreign markers override it', async () => {
  assert.equal(parseVisibleRideFares('uber', 'UberX\n$12.00').fares.length, 0);
  assert.equal(parseVisibleRideFares('uber', 'UberX\nUSD $12.00').fares[0]?.totalCents, 1200);
  assert.equal(parseVisibleRideFares('uber', 'UberX US$12.00').fares[0]?.totalCents, 1200);
  assert.equal(parseVisibleRideFares('uber', 'UberX\n$12.00', 'USD').fares[0]?.totalCents, 1200);
  assert.equal(parseVisibleRideFares('uber', 'UberX\nCAD $12.00', 'USD').fares.length, 0);
  const page = fakePage('https://m.uber.com/go', 'UberX\n$12.00');
  const unknown = await captureRides('uber', { page, fingerprint: 'f' }, request);
  assert.equal(unknown.quotes[0]?.totalCents, null);
  assert.ok(unknown.warnings.some(warning => warning.includes('Currency is unknown')));
  const nonUsd = await captureRides('uber', {
    page: fakePage('https://m.uber.com/go', 'UberX\n$12.00 CAD'), fingerprint: 'f', expectedCurrency: 'USD',
  }, request);
  assert.equal(nonUsd.quotes[0]?.totalCents, null);
});

test('only explicit destination arrival or total trip time becomes an ETA', async () => {
  assert.equal(parseRideTiming('Arrive at destination in 20 min').etaMinutes, 20);
  assert.equal(parseRideTiming('Total trip time: 23 minutes').etaMinutes, 23);
  for (const evidence of ['4 min', 'Pickup in 4 min', 'Arrives in 4 min', 'Trip duration 20 min']) {
    assert.equal(parseRideTiming(evidence).etaMinutes, null, evidence);
  }
  assert.ok(parseRideTiming('Pickup in 4 min').warnings.includes('Pickup estimate: 4 min (not destination arrival).'));
  assert.ok(parseRideTiming('Arrives in 4 min').warnings.some(warning => warning.includes('not verified destination arrival')));
  const conflict = parseRideTiming('Total trip time 20 min\nArrive at destination in 25 min');
  assert.equal(conflict.etaMinutes, null);
  assert.ok(conflict.warnings.some(warning => warning.includes('Conflicting')));
  assert.equal(parseRideTiming('Total trip time 20 min\nArrive at destination in 25–30 min').etaMinutes, null);
  assert.equal(parseRideTiming('Total trip time 20 min to 30 min').etaMinutes, null);
  const captured = await captureRides('uber', {
    page: fakePage('https://m.uber.com/go', 'UberX\nPickup in 4 min\nArrive at destination in 20 min\nUSD $12'), fingerprint: 'f',
  }, request);
  assert.equal(captured.quotes[0]?.etaMinutes, 20);
  assert.ok(captured.quotes[0]?.warnings.some(warning => warning.includes('Pickup estimate')));
});

test('missing fares and wrong origins produce unavailable null totals', async () => {
  const missing = await captureRides('lyft', { page: fakePage('https://ride.lyft.com/', 'Sign in'), fingerprint: 'f' }, request);
  assert.equal(missing.quotes[0]?.status, 'unavailable');
  assert.equal(missing.quotes[0]?.totalCents, null);
  const wrong = await captureRides('uber', {
    page: { url: () => 'https://evil.test', locator: () => { throw new Error('Must not read this page'); } } as unknown as Page,
    fingerprint: 'f',
  }, request);
  assert.equal(wrong.quotes[0]?.totalCents, null);
  assert.match(wrong.quotes[0]?.error ?? '', /allowed HTTPS origin/);
});

test('page navigation during capture invalidates the result', async () => {
  let url = 'https://m.uber.com/go';
  const page = {
    url: () => url,
    locator: () => ({ innerText: async () => { url = 'https://evil.test'; return 'UberX\n$10'; } }),
  } as unknown as Page;
  const result = await captureRides('uber', { page, fingerprint: 'f' }, request);
  assert.equal(result.quotes[0]?.status, 'unavailable');
  assert.match(result.quotes[0]?.error ?? '', /changed during capture/);
});
