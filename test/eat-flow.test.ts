import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { compareEatsAutomatically } from '../src/providers/eat-flow.js';
import { createEatsFixture, fixtureFoodRequest } from './fixtures/eat.js';

// Entire provider UI is intercepted locally. These tests prove adapter behavior,
// not production selector compatibility or live provider access.
const request = fixtureFoodRequest;

async function withFixture(provider: 'ubereats' | 'doordash', options: Parameters<typeof createEatsFixture>[0], callback: (page: Page) => Promise<void>): Promise<void> {
  const path = process.env.CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser: Browser = await chromium.launch({ headless: true, executablePath: path });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: createEatsFixture(options) }));
    await page.goto(provider === 'ubereats' ? 'https://www.ubereats.com/' : 'https://www.doordash.com/');
    await callback(page);
  } finally { await browser.close(); }
}

test('both providers: enter-once flow fills address, options, quantity, instructions and tip without purchasing', async () => {
  for (const provider of ['ubereats', 'doordash'] as const) await withFixture(provider, {}, async page => {
    const result = await compareEatsAutomatically(provider, { page, fingerprint: 'same-basket', expectedCurrency: 'USD' }, request);
    const quote = result.quotes[0]!;
    assert.equal(quote.status, 'verified', JSON.stringify(quote) + '\n' + await page.locator('body').innerText());
    assert.equal(quote.verification, 'automatic');
    assert.equal(quote.totalCents, 2900);
    assert.equal(quote.etaMinutes, 40);
    assert.deepEqual(quote.observedContext?.kind === 'eats' ? quote.observedContext.items : [], request.items);
    const state = await page.evaluate(() => (window as any).fixtureState);
    assert.equal(state.address, request.address);
    assert.equal(state.purchases, 0);
    assert.deepEqual(state.actions, ['address', 'restaurant', 'add', 'checkout', 'tip']);
  });
});

test('existing nonmatching cart is preserved before address or menu actions', async () => {
  await withFixture('doordash', { existing: true }, async page => {
    const before = await page.getByRole('region', { name: 'Your cart' }).innerText();
    const result = await compareEatsAutomatically('doordash', { page, fingerprint: 'existing', expectedCurrency: 'USD' }, request);
    assert.equal(result.quotes[0]!.status, 'unavailable');
    assert.match(result.quotes[0]!.error!, /existing cart was preserved/i);
    assert.equal(await page.getByRole('region', { name: 'Your cart' }).innerText(), before);
    assert.deepEqual(await page.evaluate(() => (window as any).fixtureState.actions), []);
  });
});

test('wrong branch prevents adding any requested items', async () => {
  await withFixture('ubereats', { wrongBranch: true }, async page => {
    const result = await compareEatsAutomatically('ubereats', { page, fingerprint: 'branch', expectedCurrency: 'USD' }, request);
    assert.equal(result.quotes[0]!.totalCents, null);
    assert.match(result.quotes[0]!.error!, /branch/i);
    assert.deepEqual(await page.evaluate(() => (window as any).fixtureState.items), []);
  });
});

test('independently observed quantity/options/address and final total must be complete and match', async () => {
  for (const options of [{ wrongQuantity: true }, { wrongModifier: true }, { missingContext: true }, { missingTotal: true }]) await withFixture('doordash', options, async page => {
    const quote = (await compareEatsAutomatically('doordash', { page, fingerprint: 'mismatch', expectedCurrency: 'USD' }, request)).quotes[0]!;
    assert.equal(quote.status, 'unavailable');
    assert.equal(quote.totalCents, null);
    assert.equal(await page.evaluate(() => (window as any).fixtureState.purchases), 0);
  });
});

test('an existing matching checkout is reused without adding duplicates or purchasing', async () => {
  await withFixture('ubereats', {}, async page => {
    const context = { page, fingerprint: 'repeat', expectedCurrency: 'USD' as const };
    assert.equal((await compareEatsAutomatically('ubereats', context, request)).quotes[0]!.status, 'verified');
    const actions = await page.evaluate(() => (window as any).fixtureState.actions);
    assert.equal((await compareEatsAutomatically('ubereats', context, request)).quotes[0]!.status, 'verified');
    assert.deepEqual(await page.evaluate(() => (window as any).fixtureState.actions), actions);
    assert.equal(await page.evaluate(() => (window as any).fixtureState.items.length), 1);
  });
});

test('plain dollars require independently observed U.S. addresses; configured expected currency alone is insufficient', async () => {
  await withFixture('doordash', { currency: '' }, async page => {
    const quote = (await compareEatsAutomatically('doordash', { page, fingerprint: 'us-context' }, request)).quotes[0]!;
    assert.equal(quote.status, 'verified', quote.error);
    assert.equal(quote.observedContext?.currencyEvidence, 'observed-us-addresses');
  });
  for (const options of [{ currency: '', foreignAddress: true }, { currency: 'CAD' }]) await withFixture('doordash', options, async page => {
    const quote = (await compareEatsAutomatically('doordash', { page, fingerprint: 'foreign-context', expectedCurrency: 'USD' }, request)).quotes[0]!;
    assert.equal(quote.status, 'unavailable');
    assert.equal(quote.totalCents, null);
  });
});

test('public-source selector leads support address placeholder, merchant card, priced menu tile and quantity counter', async () => {
  await withFixture('ubereats', { selectorVariant: true }, async page => {
    const quote = (await compareEatsAutomatically('ubereats', { page, fingerprint: 'selector-variant' }, request)).quotes[0]!;
    assert.equal(quote.status, 'verified', JSON.stringify(quote) + '\n' + await page.locator('body').innerText());
    assert.equal(quote.totalCents, 2900);
    assert.equal(await page.evaluate(() => (window as any).fixtureState.purchases), 0);
  });
});
