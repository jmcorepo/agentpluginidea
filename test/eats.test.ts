import assert from 'node:assert/strict';
import test from 'node:test';
import { captureEats, isOfficialEatsUrl, parseEatsCheckoutText } from '../src/providers/eats.js';
import type { ProviderContext } from '../src/domain.js';

test('exact final total wins over subtotal; explicit fields and range are retained', () => {
  const result = parseEatsCheckoutText('Checkout\nCurrency USD\nSubtotal\n$20.00\nDelivery fee $2.00\nService fee $3.00\nTax $1.50\nTip $4.00\nTotal\n$30.50\nEstimated delivery: 25–40 minutes');
  assert.equal(result.totalCents, 3050);
  assert.deepEqual(result.breakdown, { subtotalCents: 2000, taxCents: 150, serviceFeeCents: 300, deliveryFeeCents: 200, tipCents: 400 });
  assert.equal(result.etaMinutes, 40);
});

test('subtotal-only, item amounts, and qualified nonfinal totals are never final prices', () => {
  for (const text of ['Checkout\nUSD\nSubtotal $15.00', 'Checkout\nUSD\nBurger $15.00', 'Checkout\nUSD\nTotal before taxes $15.00']) {
    assert.equal(parseEatsCheckoutText(text).totalCents, null);
  }
});

test('missing fees are unknown rather than zero', () => {
  const result = parseEatsCheckoutText('Place order\nTotal USD 19.95');
  assert.equal(result.totalCents, 1995);
  assert.deepEqual(result.breakdown, {});
  assert.equal(result.etaMinutes, null);
});

test('unqualified dollars, foreign currency, and conflicting currency are rejected', () => {
  for (const text of ['Checkout\nTotal $12.00', 'Checkout\nTotal CAD 12.00', 'Checkout\nUSD\nTotal $12.00\nCAD $13.00', 'Checkout\nTotal €12.00']) {
    assert.equal(parseEatsCheckoutText(text).totalCents, null);
  }
});

test('explicit U.S. pilot context permits plain dollars with currency confirmation warning', () => {
  const result = parseEatsCheckoutText('Checkout\nTotal $12.00', { expectedCurrency: 'USD' });
  assert.equal(result.totalCents, 1200);
  assert.ok(result.warnings.includes('USD assumed for U.S. pilot; confirm currency on the provider page.'));
  for (const text of ['Checkout\nTotal CAD $12.00', 'Checkout\nTotal €12.00', 'Checkout\nTotal $12.00\nCurrency AUD']) {
    assert.equal(parseEatsCheckoutText(text, { expectedCurrency: 'USD' }).totalCents, null);
  }
});

test('conflicting totals and multi-amount totals are ambiguous', () => {
  assert.equal(parseEatsCheckoutText('Checkout\nUSD\nTotal $12.00\nOrder total $13.00').totalCents, null);
  assert.equal(parseEatsCheckoutText('Checkout\nUSD\nTotal\n$12.00 $13.00').totalCents, null);
  assert.equal(parseEatsCheckoutText('Checkout\nUSD\nTotal $12.00\nOrder total $13.00 $14.00').totalCents, null);
  assert.equal(parseEatsCheckoutText('Checkout\nUSD\nTotal $12.00\nOrder total').totalCents, null);
});

test('no checkout, negative totals, malformed money and overflowing values are unavailable', () => {
  for (const text of ['Menu\nUSD\nTotal $12.00', 'Checkout\nTotal USD -12.00', 'Checkout\nTotal USD 12.3', 'Checkout\nTotal USD 999999999999999999.00']) {
    assert.equal(parseEatsCheckoutText(text).totalCents, null);
  }
});

test('promotional membership advertisements do not become applied benefits', () => {
  const result = parseEatsCheckoutText('Checkout\nTotal USD 12.00\nJoin DashPass and save $5.00\nUber One\nDiscount USD -2.00\nDashPass delivery fee discount applied');
  assert.equal(result.breakdown.discountCents, 200);
  assert.equal(result.benefits.length, 2);
  assert.ok(!result.evidence.includes('Join DashPass'));
});

test('evidence contains only matching pricing and estimate labels, not arbitrary page text', () => {
  const result = parseEatsCheckoutText('Checkout\nalice@example.com\nSaved payment 1234\nTotal USD 12.00\nEstimated preparation: 20 minutes\nDelivery in 35 minutes');
  assert.equal(result.etaMinutes, 35);
  assert.ok(!result.evidence.includes('alice'));
  assert.ok(!result.evidence.includes('1234'));
});

test('official origins are same-family HTTPS domains without credentials', () => {
  assert.ok(isOfficialEatsUrl('ubereats', 'https://www.ubereats.com/checkout'));
  assert.ok(isOfficialEatsUrl('doordash', 'https://doordash.com/checkout'));
  assert.ok(isOfficialEatsUrl('ubereats', 'https://checkout.us.ubereats.com/checkout'));
  assert.ok(isOfficialEatsUrl('doordash', 'https://checkout.us.doordash.com/checkout'));
  for (const url of ['https://accounts.google.com', 'https://appleid.apple.com', 'https://auth.uber.com', 'https://www.doordash.com/checkout']) assert.equal(isOfficialEatsUrl('ubereats', url), false);
  for (const url of ['http://www.ubereats.com/checkout', 'https://www.ubereats.com.evil.example/checkout', 'https://evil.example/?next=https://ubereats.com', 'https://user:secret@ubereats.com/checkout', 'https://ubereats.com:8080/checkout']) assert.equal(isOfficialEatsUrl('ubereats', url), false);
});

function mockContext(text: string, url = 'https://www.doordash.com/checkout?session=secret'): ProviderContext {
  return { fingerprint: 'test-request', page: { url: () => url, locator: () => ({ innerText: async () => text }) } as unknown as ProviderContext['page'] };
}
const request = { address: '123 Main St', restaurant: 'Example', items: [{ name: 'Burger', quantity: 1 }], tipCents: 300 };

test('capture requires exact basket confirmation and rejects tip mismatch without leaking URL query', async () => {
  const result = await captureEats('doordash', mockContext('Checkout\nTotal USD 12.00\nTip USD 2.00'), request);
  const quote = result.quotes[0]!;
  assert.equal(quote.status, 'unavailable');
  assert.equal(quote.totalCents, null);
  assert.equal(quote.requestFingerprint, 'test-request');
  assert.ok(quote.warnings.some(warning => warning.includes('differs')));
  assert.ok(quote.warnings.some(warning => warning.includes('restaurant branch')));
  assert.equal(quote.checkoutUrl, 'https://www.doordash.com/checkout');
  assert.match(quote.id, /^[a-f\d-]{36}$/);
});

test('missing checkout tip remains pending confirmation; matching explicit tip does too', async () => {
  for (const text of ['Checkout\nTotal USD 12.00', 'Checkout\nTotal USD 12.00\nTip USD 3.00']) {
    const quote = (await captureEats('doordash', mockContext(text), request)).quotes[0]!;
    assert.equal(quote.status, 'needs_confirmation');
    assert.equal(quote.totalCents, 1200);
  }
});

test('complete explicit breakdown must reconcile, without inferring missing fees or discounts', () => {
  const breakdown = 'Subtotal USD 10.00\nTax USD 1.00\nService fee USD 2.00\nDelivery fee USD 3.00\nTip USD 4.00\nDiscount USD 1.00';
  assert.equal(parseEatsCheckoutText(`Checkout\n${breakdown}\nTotal USD 19.00`).totalCents, 1900);
  assert.equal(parseEatsCheckoutText(`Checkout\n${breakdown}\nTotal USD 20.00`).totalCents, null);
  assert.equal(parseEatsCheckoutText('Checkout\nSubtotal USD 10.00\nTotal USD 20.00').totalCents, 2000);
});

test('unsupported page is unavailable and never read', async () => {
  const context: ProviderContext = { fingerprint: 'test', page: { url: () => 'https://evil.example', locator: () => { throw new Error('must not be read'); } } as unknown as ProviderContext['page'] };
  assert.equal((await captureEats('doordash', context, request)).quotes[0]!.status, 'unavailable');
});

test('login page produces an unavailable result with login guidance', async () => {
  const result = await captureEats('doordash', mockContext('Sign in\nEmail\nPassword'), request);
  assert.equal(result.quotes[0]!.totalCents, null);
  assert.ok(result.warnings.some(warning => warning.includes('Sign in yourself')));
});
