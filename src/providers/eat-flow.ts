import { randomUUID } from 'node:crypto';
import type { Locator, Page } from 'playwright';
import type { CaptureResult, FoodRequest, ObservedFoodContext, ProviderContext, Quote } from '../domain.js';
import { isPurchaseControl } from '../browser.js';
import { addressesMatch, isUsAddress, verifyQuoteContext } from '../verification.js';
import { captureEats, isOfficialEatsUrl, parseEatsCheckoutText } from './eats.js';

type EatsProvider = 'ubereats' | 'doordash';
const timeout = 5_000;
const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
class ActionRequired extends Error {}
// Public UI selector leads inspected on 2026-10-01 in:
// github.com/markswendsen-code/{mcp-ubereats,mcp-doordash}/blob/main/src/browser.ts
// These are third-party leads, not live-provider verification. No implementation,
// stealth configuration, private API calls, or unsafe defaults are reused.

async function singleVisible(candidates: Locator[], description: string): Promise<Locator> {
  const deadline = Date.now() + timeout;
  do {
    for (const candidate of candidates) {
      const count = await candidate.count();
      const visible: Locator[] = [];
      for (let index = 0; index < count; index++) if (await candidate.nth(index).isVisible()) visible.push(candidate.nth(index));
      if (visible.length > 1) throw new ActionRequired(`Multiple ${description} controls are visible. Narrow the request or finish this step in the provider browser.`);
      if (visible.length === 1) return visible[0]!;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new ActionRequired(`The provider's ${description} control is unsupported or unavailable. Check the connected provider browser.`);
}

async function safeClick(provider: EatsProvider, page: Page, locator: Locator): Promise<void> {
  if (!isOfficialEatsUrl(provider, page.url())) throw new ActionRequired('The provider requires authentication. Finish signing in directly on its website.');
  const label = await locator.evaluate(element => element.getAttribute('aria-label') ?? element.textContent ?? '');
  if (isPurchaseControl(label)) throw new ActionRequired('This action could purchase an order. Automatic purchasing is disabled.');
  await locator.click({ timeout });
}

function requireOfficial(provider: EatsProvider, page: Page): void {
  if (!isOfficialEatsUrl(provider, page.url())) throw new ActionRequired('Finish signing in directly with the provider. Automatic preparation stops outside the provider website.');
}

async function optionalVisible(candidate: Locator): Promise<Locator | null> {
  const count = await candidate.count();
  const found: Locator[] = [];
  for (let index = 0; index < count; index++) if (await candidate.nth(index).isVisible()) found.push(candidate.nth(index));
  if (found.length > 1) throw new ActionRequired('The provider shows ambiguous controls. Check the connected browser.');
  return found[0] ?? null;
}

async function visibleText(candidate: Locator): Promise<string | null> {
  const node = await optionalVisible(candidate);
  return node ? (await node.innerText({ timeout })).trim() || null : null;
}

async function fillQuantity(provider: EatsProvider, page: Page, dialog: Locator, quantity: number): Promise<void> {
  const field = await optionalVisible(dialog.getByRole('spinbutton', { name: /^quantity$/i }));
  if (field) { requireOfficial(provider, page); await field.fill(String(quantity), { timeout }); return; }
  // The public connectors identify increment controls but default quantity to 1.
  // We require a visible numeric counter before and after each bounded action.
  const counter = await singleVisible([dialog.getByTestId('item-quantity')], 'visible item quantity');
  for (let attempt = 0; attempt < 25; attempt++) {
    const value = (await counter.innerText({ timeout })).trim();
    if (!/^\d+$/.test(value)) throw new ActionRequired('The visible item quantity is ambiguous.');
    const current = Number(value);
    if (current === quantity) return;
    const button = await singleVisible(current < quantity
      ? [dialog.getByRole('button', { name: /increase/i }), dialog.getByTestId('quantity-increase')]
      : [dialog.getByRole('button', { name: /decrease/i })], 'quantity adjustment');
    await safeClick(provider, page, button);
  }
  throw new ActionRequired('Item quantity did not reach the requested value. The cart was preserved.');
}

function labelledLine(text: string, label: string): string | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const values: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (normalized(line) === normalized(label)) {
      if (lines[index + 1]) values.push(lines[index + 1]!);
    } else if (normalized(line).startsWith(`${normalized(label)}:`)) values.push(line.slice(line.indexOf(':') + 1).trim());
  }
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0]! : null;
}

async function observeCheckout(page: Page, context: ProviderContext): Promise<ObservedFoodContext> {
  const text = await page.locator('body').innerText({ timeout });
  const restaurant = labelledLine(text, 'Restaurant') ?? await visibleText(page.getByTestId('cart-restaurant-name'));
  const restaurantAddress = labelledLine(text, 'Restaurant address');
  const address = labelledLine(text, 'Delivery address') ?? await visibleText(page.getByTestId('delivery-address'));
  const delivery = labelledLine(text, 'Delivery method');
  const currencyEvidence = /\bUSD\b/i.test(text) ? 'USD' : /\bUS\$/i.test(text) ? 'US$' : restaurantAddress && address && isUsAddress(restaurantAddress) && isUsAddress(address) ? 'observed-us-addresses' : null;
  if (!currencyEvidence) throw new ActionRequired('USD currency is not established by an explicit currency label or independently observed U.S. merchant and delivery addresses.');
  const parsed = parseEatsCheckoutText(text, { expectedCurrency: 'USD' });
  if (!restaurant || !restaurantAddress || !address || normalized(delivery ?? '') !== 'standard' || parsed.breakdown.tipCents === undefined) {
    throw new ActionRequired('Checkout must visibly identify the restaurant branch, delivery address, standard delivery, and exact tip. No complete independent context was found.');
  }
  const list = await optionalVisible(page.getByRole('list', { name: /^order items$/i })) ?? await optionalVisible(page.getByRole('list', { name: /^(?:cart|basket) items$/i }));
  const rows = list ? list.getByRole('listitem') : page.locator('[data-testid="checkout-item"], [data-testid="checkout-cart-item"], [data-testid="cart-item"]');
  const items: ObservedFoodContext['items'] = [];
  const itemEvidence: string[] = [];
  for (let index = 0; index < await rows.count(); index++) {
    const row = rows.nth(index);
    if (!await row.isVisible()) continue;
    const rowText = await row.innerText({ timeout });
    const name = labelledLine(rowText, 'Item') ?? await visibleText(row.getByRole('heading'));
    const rawQuantity = labelledLine(rowText, 'Quantity') ?? await visibleText(row.getByTestId('item-quantity'));
    const quantityText = rawQuantity?.match(/^(?:[x×]\s*)?(\d+)(?:\s*[x×])?$/)?.[1] ?? null;
    const instructions = labelledLine(rowText, 'Instructions');
    const modifierText = labelledLine(rowText, 'Modifiers');
    if (!name || !quantityText || !/^\d+$/.test(quantityText) || !instructions || !modifierText) {
      throw new ActionRequired('Checkout item names, quantities, instructions, or selected modifiers are not fully visible. No guessed basket will be ranked.');
    }
    const quantity = Number(quantityText);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new ActionRequired('Checkout item quantity is invalid.');
    const modifiers: { group: string; option: string }[] = [];
    if (normalized(modifierText) !== 'none') {
      for (const entry of modifierText.split(';')) {
        const parts = entry.match(/^\s*([^:]+):\s*([^:]+)\s*$/);
        if (!parts) throw new ActionRequired('Selected item modifiers are ambiguous. No guessed options will be ranked.');
        modifiers.push({ group: parts[1]!.trim(), option: parts[2]!.trim() });
      }
    }
    const notes = normalized(instructions) === 'none' ? undefined : instructions;
    items.push({ name, quantity, modifiers, ...(notes ? { notes } : {}) });
    itemEvidence.push(`Item: ${name}; Quantity: ${quantity}; Modifiers: ${modifierText}; Instructions: ${instructions}`);
  }
  if (!items.length) throw new ActionRequired('The checkout basket is empty or unsupported.');
  return {
    kind: 'eats', source: 'provider_dom', restaurant, restaurantAddress, address,
    deliverySpeed: 'standard', tipCents: parsed.breakdown.tipCents, items, currencyEvidence,
    evidence: [`Restaurant: ${restaurant}`, `Restaurant address: ${restaurantAddress}`, `Delivery address: ${address}`, `Delivery method: ${delivery}`, ...itemEvidence, `Tip: USD ${(parsed.breakdown.tipCents / 100).toFixed(2)}`].join('\n'),
  };
}

async function settleCheckout(page: Page): Promise<void> {
  let previous = await page.locator('body').innerText({ timeout });
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.waitForTimeout(150);
    const current = await page.locator('body').innerText({ timeout });
    if (current === previous) return;
    previous = current;
  }
  throw new ActionRequired('Checkout is still changing. Retry when provider prices have settled.');
}

async function verifiedCapture(provider: EatsProvider, context: ProviderContext, request: FoodRequest): Promise<CaptureResult> {
  await settleCheckout(context.page);
  const observed = await observeCheckout(context.page, context);
  const result = await captureEats(provider, { ...context, expectedCurrency: 'USD' }, request);
  const after = await observeCheckout(context.page, context);
  const finalPrice = parseEatsCheckoutText(await context.page.locator('body').innerText({ timeout }), { expectedCurrency: 'USD' }).totalCents;
  for (const quote of result.quotes) {
    quote.observedContext = observed;
    const mismatch = JSON.stringify(observed) !== JSON.stringify(after) || finalPrice !== quote.totalCents ? 'Checkout context or price changed during capture. Retry.' : verifyQuoteContext(quote, request);
    if (mismatch || quote.totalCents === null || quote.error) {
      quote.status = 'unavailable';
      quote.totalCents = null;
      quote.error = mismatch ?? quote.error ?? 'A complete final checkout total was not captured.';
      quote.warnings.push(quote.error);
    } else {
      quote.status = 'verified';
      quote.verification = 'automatic';
      quote.warnings = quote.warnings.filter(warning => !warning.startsWith('Confirm the exact restaurant'));
      quote.warnings.push('Prepared automatically through provider UI; no order was placed. Live-provider selector coverage has not been verified.');
      quote.evidence += `\n${observed.evidence}`;
    }
  }
  result.warnings = [...new Set(result.quotes.flatMap(quote => quote.warnings))];
  return result;
}

/** UI-only prototype. Selector coverage is tested against local fixtures, not live providers. */
export async function compareEatsAutomatically(provider: EatsProvider, context: ProviderContext, request: FoodRequest): Promise<CaptureResult> {
  const page = context.page;
  function unavailable(message: string): CaptureResult {
    const quote: Quote = {
      id: randomUUID(), provider, sector: 'eats', status: 'unavailable', source: 'browser',
      label: `${provider === 'ubereats' ? 'Uber Eats' : 'DoorDash'} automatic comparison`,
      totalCents: null, currency: 'USD', capturedAt: new Date().toISOString(), expiresAt: null,
      etaMinutes: null, benefits: [], warnings: [message], evidence: '', requestFingerprint: context.fingerprint, error: message,
    };
    return { quotes: [quote], warnings: [message] };
  }
  try {
    if (!request.restaurantAddress) throw new ActionRequired('Specify the restaurant physical branch address so both providers can match the same merchant.');
    if (!isOfficialEatsUrl(provider, page.url())) throw new ActionRequired('Open this provider and finish signing in directly on its website.');
    // The cart is inspected BEFORE any address, merchant, or item changes.
    let cart = await optionalVisible(page.getByRole('region', { name: /^(?:your )?(?:cart|basket)$/i })) ?? await optionalVisible(page.getByTestId('empty-cart'));
    if (!cart) {
      const openCart = await singleVisible([page.getByRole('button', { name: /^(?:view )?cart(?:\s*\(\d+\)|,?\s*\d+ items?)?$/i }), page.getByTestId('cart-button')], 'cart');
      await safeClick(provider, page, openCart);
      cart = await singleVisible([page.getByRole('region', { name: /^(?:your )?(?:cart|basket)$/i }), page.getByTestId('empty-cart')], 'cart summary');
    }
    const cartText = await cart.innerText({ timeout });
    const cartItems = page.locator('[data-testid="cart-item"], [data-testid="checkout-cart-item"]');
    let populated = false;
    for (let index = 0; index < await cartItems.count(); index++) if (await cartItems.nth(index).isVisible()) populated = true;
    if (populated || !/^(?:(?:your )?(?:cart|basket) is empty|no items)$/im.test(cartText)) {
      // Reuse a complete matching checkout without changing its cart or tip.
      if (await optionalVisible(page.getByRole('heading', { name: /^checkout$/i }))) {
        const current = await verifiedCapture(provider, context, request);
        if (current.quotes.some(quote => quote.status === 'verified')) return current;
      }
      throw new ActionRequired('An existing cart was preserved. Automatic comparison will not replace it. Finish or save that cart on the provider before starting a new basket.');
    }
    const closeCart = await optionalVisible(page.getByRole('button', { name: /^close cart$/i }));
    if (closeCart) await safeClick(provider, page, closeCart);

    const addressButton = await optionalVisible(page.getByRole('button', { name: /^(?:your address|enter delivery address)$/i })) ?? await optionalVisible(page.getByTestId('home-feed-location-bar'));
    if (addressButton) await safeClick(provider, page, addressButton);
    const address = await singleVisible([
      page.getByRole('textbox', { name: /^(?:enter )?(?:delivery )?address$/i }),
      page.getByRole('combobox', { name: /^(?:enter )?(?:delivery )?address$/i }),
      page.getByPlaceholder(/(?:enter )?delivery address/i),
      page.getByTestId('address-input'),
    ], 'delivery address');
    requireOfficial(provider, page);
    await address.fill(request.address, { timeout });
    const exactAddress = page.getByText(request.address, { exact: true });
    await safeClick(provider, page, await singleVisible([page.getByRole('option', { name: request.address, exact: true }), page.getByTestId('address-autocomplete-result').filter({ has: exactAddress })], 'exact delivery address suggestion'));
    const saveAddress = await optionalVisible(page.getByRole('button', { name: /^(?:use this address|save address|confirm address|find restaurants)$/i })) ?? await optionalVisible(page.getByTestId('address-confirm'));
    if (saveAddress) await safeClick(provider, page, saveAddress);

    const search = await optionalVisible(page.getByRole('searchbox', { name: /search/i })) ?? await optionalVisible(page.getByRole('textbox', { name: /^(?:search|search (?:restaurants|stores|Uber Eats|DoorDash))$/i }));
    requireOfficial(provider, page);
    if (search) await search.fill(request.restaurant, { timeout });
    else {
      // Documented public storefront navigation, not a private JSON endpoint.
      const searchUrl = provider === 'ubereats' ? `https://www.ubereats.com/search?q=${encodeURIComponent(request.restaurant)}` : `https://www.doordash.com/search/store/${encodeURIComponent(request.restaurant)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      requireOfficial(provider, page);
    }
    // Exact merchant names only. Duplicate branches require a physical branch identifier.
    const merchant = await singleVisible([
      page.getByRole('link', { name: request.restaurant, exact: true }),
      page.getByRole('button', { name: request.restaurant, exact: true }),
      page.locator('a[href*="/store/"]').filter({ has: page.getByText(request.restaurant, { exact: true }) }),
      page.getByTestId('store-card').filter({ has: page.getByText(request.restaurant, { exact: true }) }),
    ], 'exact restaurant result');
    await safeClick(provider, page, merchant);
    const merchantText = await page.locator('body').innerText({ timeout });
    const branch = labelledLine(merchantText, 'Restaurant address');
    if (!branch || !addressesMatch(request.restaurantAddress, branch)) throw new ActionRequired('The selected restaurant branch could not be independently matched. No items were added.');

    for (const item of request.items) {
      const menuItem = await singleVisible([page.getByRole('button', { name: item.name, exact: true }), page.locator('[data-testid="menu-item"], [data-testid="store-menu-item-tile"]').filter({ has: page.getByText(item.name, { exact: true }) })], `menu item ${item.name}`);
      await safeClick(provider, page, menuItem);
      const dialog = await singleVisible([page.getByRole('dialog', { name: item.name, exact: true }), page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: item.name, exact: true }) })], 'item options');
      await fillQuantity(provider, page, dialog, item.quantity);
      for (const modifier of item.modifiers ?? []) {
        const group = await singleVisible([dialog.getByRole('group', { name: modifier.group, exact: true })], `modifier group ${modifier.group}`);
        const option = await singleVisible([group.getByRole('radio', { name: modifier.option, exact: true }), group.getByRole('checkbox', { name: modifier.option, exact: true })], `modifier option ${modifier.option}`);
        if (!isOfficialEatsUrl(provider, page.url())) throw new ActionRequired('Finish authenticating with the provider.');
        await option.check({ timeout });
      }
      if (item.notes) {
        const notes = await singleVisible([dialog.getByRole('textbox', { name: /^(?:special|additional) instructions$/i }), dialog.getByPlaceholder(/instruction|special/i), dialog.getByTestId('special-instructions-input')], 'item instructions');
        requireOfficial(provider, page);
        await notes.fill(item.notes, { timeout });
      }
      const add = await singleVisible([dialog.getByRole('button', { name: /^add(?: \d+)?(?: items?)? to (?:cart|order)(?:\s*[-–]?\s*\$\d+(?:\.\d{2})?)?$/i }), dialog.getByTestId('add-to-cart-button'), dialog.getByTestId('add-item-button')], 'add item');
      await safeClick(provider, page, add);
      await dialog.waitFor({ state: 'hidden', timeout });
    }

    const checkout = await singleVisible([page.getByRole('button', { name: /^(?:go to |continue to )?checkout$/i }), page.getByRole('link', { name: /^(?:go to )?checkout$/i }), page.getByTestId('checkout-button')], 'checkout');
    await safeClick(provider, page, checkout);
    await page.getByRole('heading', { name: /^checkout$/i }).waitFor({ state: 'visible', timeout });
    const standard = await singleVisible([page.getByRole('radio', { name: /^standard$/i })], 'standard delivery');
    requireOfficial(provider, page);
    await standard.check({ timeout });
    const tip = await singleVisible([page.getByRole('textbox', { name: /^(?:custom tip|tip amount)$/i }), page.getByRole('spinbutton', { name: /^(?:custom tip|tip amount)$/i })], 'tip amount');
    requireOfficial(provider, page);
    await tip.fill((request.tipCents / 100).toFixed(2), { timeout });
    await tip.press('Tab', { timeout });
    const applyTip = await optionalVisible(page.getByRole('button', { name: /^(?:apply|save) tip$/i }));
    if (applyTip) await safeClick(provider, page, applyTip);

    return await verifiedCapture(provider, context, request);
  } catch (error) {
    return unavailable(error instanceof ActionRequired ? error.message : 'The provider interface changed, requires authentication, or has an unavailable item. The prepared cart was preserved; inspect the provider browser and retry.');
  }
}
