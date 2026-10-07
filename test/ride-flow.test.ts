import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { compareRidesAutomatically, parseResolvedRideRoute, readRideCapacity } from '../src/providers/ride-flow.js';
import { verifyQuoteContext } from '../src/verification.js';

import { createRideFixture, fixtureRideRequest as request, type RideFixtureOptions } from './fixtures/ride.js';
let browser: Browser;
before(async () => {
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
});
after(async () => { await browser?.close(); });


async function runFixture(provider: 'uber' | 'lyft', options: RideFixtureOptions = {}, requested = request) {
  const page = await browser.newPage();
  let liveRequests = 0;
  await page.route('**/*', route => {
    liveRequests++;
    return route.fulfill({ contentType: 'text/html', body: createRideFixture(provider, options) });
  });
  await page.goto(provider === 'uber' ? 'https://m.uber.com/go' : 'https://ride.lyft.com/');
  const result = await compareRidesAutomatically(provider, { page, fingerprint: 'fixture-request', expectedCurrency: 'USD' }, requested);
  const events = await page.evaluate(() => (window as unknown as { fixtureEvents?: { addresses: { field: string; value: string }[]; searches: number; bookings: number } }).fixtureEvents);
  assert.equal(liveRequests, 1, 'Only the in-memory fixture document was loaded; no provider requests occur.');
  assert.equal(events?.bookings ?? 0, 0, 'Price comparison must never click a request control.');
  await page.close();
  return { result, events };
}

test('automatic flow enters both addresses once and independently verifies Uber and Lyft quotes', async () => {
  for (const provider of ['uber', 'lyft'] as const) {
    const { result, events } = await runFixture(provider);
    assert.deepEqual(events?.addresses, [
      { field: 'pickup', value: request.pickup }, { field: 'destination', value: request.destination },
    ]);
    assert.equal(events?.searches, 1);
    const quote = result.quotes[0]!;
    assert.equal(quote.status, 'verified', quote.error);
    assert.equal(quote.verification, 'automatic');
    assert.equal(quote.totalCents, 1925);
    assert.equal(quote.etaMinutes, 23);
    assert.equal(quote.observedContext?.kind, 'rides');
    assert.equal(quote.observedContext?.source, 'provider_dom');
    assert.equal(verifyQuoteContext(quote, request), null);
    assert.ok(quote.warnings.some(warning => warning.includes('Pickup estimate: 4 min')));
  }
});

test('a provider-resolved address mismatch never becomes a comparable quote', async () => {
  const { result } = await runFixture('uber', { mismatchedRoute: true });
  assert.equal(result.quotes[0]?.status, 'unavailable');
  assert.equal(result.quotes[0]?.totalCents, null);
  assert.match(result.quotes[0]?.error ?? '', /resolved route matching both/);
});

test('input echoes alone are not independent route proof', async () => {
  const { result } = await runFixture('lyft', { hideSummary: true });
  assert.equal(result.quotes[0]?.status, 'unavailable');
  assert.equal(result.quotes[0]?.totalCents, null);
  const editable = await runFixture('uber', { editableSummary: true });
  assert.equal(editable.result.quotes[0]?.status, 'unavailable');
});

test('old fares cannot win while the new route summary precedes its delayed price refresh', async () => {
  const { result } = await runFixture('uber', { keepOldFare: true, delayPriceMs: 650 });
  assert.equal(result.quotes[0]?.status, 'verified');
  assert.equal(result.quotes[0]?.totalCents, 1925, 'Must capture the refreshed fare, never the old $54.60.');
  const stale = await runFixture('lyft', { keepOldFare: true, neverRefreshFare: true });
  assert.equal(stale.result.quotes[0]?.status, 'unavailable');
  assert.equal(stale.result.quotes[0]?.totalCents, null);
  assert.match(stale.result.quotes[0]?.error ?? '', /did not visibly refresh/);
});

test('unconnected accounts, uncertain currency, different category and insufficient capacity fail closed', async () => {
  for (const options of [{ login: true }, { currency: 'CAD ' }, { category: 'Comfort' }, { capacity: 1 }, { shared: true }]) {
    const { result } = await runFixture('uber', options);
    assert.equal(result.quotes[0]?.status, 'unavailable', JSON.stringify(options));
    assert.equal(result.quotes[0]?.totalCents, null);
  }
  const unknown = await runFixture('uber', { currency: '' }, { pickup: '123 Main Street', destination: '456 Oak Road', passengers: 2 });
  assert.equal(unknown.result.quotes[0]?.status, 'unavailable');
  assert.match(unknown.result.quotes[0]?.error ?? '', /did not establish USD/);
  const observedUs = await runFixture('uber', { currency: '' });
  assert.equal(observedUs.result.quotes[0]?.status, 'verified');
  assert.equal(observedUs.result.quotes[0]?.observedContext?.currencyEvidence, 'observed-us-addresses');
});

test('ambiguous address resolution fails without submitting or booking', async () => {
  const { result, events } = await runFixture('uber', { wrongAutocomplete: true });
  assert.equal(result.quotes[0]?.status, 'unavailable');
  assert.equal(events?.searches, 0);
  assert.equal(events?.bookings, 0);
});

test('route summary and capacity parsers reject missing or competing context', () => {
  assert.equal(parseResolvedRideRoute('Pickup\nDestination\n$19.25'), null);
  assert.equal(parseResolvedRideRoute('Pickup: A\nPickup: B\nDestination: C'), null);
  assert.equal(readRideCapacity('4 seats\n2 passengers'), null);
  assert.equal(readRideCapacity('No capacity displayed'), null);
  assert.equal(readRideCapacity('4–6 passengers'), null);
  assert.equal(readRideCapacity('Capacity: 4'), 4);
});
