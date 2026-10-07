import { randomUUID } from 'node:crypto';
import type { Locator, Page } from 'playwright';
import type { CaptureResult, ProviderContext, Quote, RideRequest } from '../domain.js';
import { isAllowedRideUrl, parseVisibleRideFares } from './rides.js';
import { addressesMatch, isUsAddress, normalizeText, verifyQuoteContext } from '../verification.js';

type RideProvider = 'uber' | 'lyft';
const entryUrls: Record<RideProvider, string> = { uber: 'https://m.uber.com/go', lyft: 'https://ride.lyft.com/' };
const routeNames = /^(?:route summary|trip details|ride details|journey details|your route)$/i;
const priceRegionNames = /^(?:ride options|ride prices|available rides|ride estimates|ride results)$/i;
const quoteControl = /^(?:see prices|see rides|find rides|find a ride|get estimate|compare rides|search)$/i;
const timeout = 8_000;

export function normalizeRideAddress(value: string): string {
  return normalizeText(value);
}

/** Reads resolved display text, never textbox values or the strings we submitted. */
export function parseResolvedRideRoute(text: string): { pickup: string; destination: string; evidence: string } | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const values: Record<'pickup' | 'destination', string[]> = { pickup: [], destination: [] };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const match = /^(pickup(?: location)?|origin|drop[- ]?off(?: location)?|destination)\s*:\s*(.+)$/i.exec(line);
    const standalone = /^(pickup(?: location)?|origin|drop[- ]?off(?: location)?|destination)\s*:?$/i.exec(line);
    const label = match?.[1] ?? standalone?.[1];
    const value = match?.[2] ?? (standalone ? lines[index + 1] : undefined);
    if (!label || !value || /^(?:pickup|destination|origin|drop[- ]?off)(?: location)?\s*:?$/i.test(value)) continue;
    const key = /pickup|origin/i.test(label) ? 'pickup' : 'destination';
    values[key].push(value);
  }
  if (values.pickup.length !== 1 || values.destination.length !== 1) return null;
  return { pickup: values.pickup[0]!, destination: values.destination[0]!, evidence: text.trim() };
}

export function readRideCapacity(evidence: string): number | null {
  if (/\b\d+\s*[-–—]\s*\d+\s*(?:seats?|passengers?|riders?)\b/i.test(evidence)) return null;
  const counts = [...evidence.matchAll(/\b(?:(\d+)\s*(?:seats?|passengers?|riders?)|(?:seats?|capacity|passengers?)\s*:\s*(\d+))\b/gi)]
    .map(match => Number(match[1] ?? match[2]));
  const unique = [...new Set(counts)];
  return unique.length === 1 && Number.isSafeInteger(unique[0]) && unique[0]! > 0 ? unique[0]! : null;
}

async function uniqueVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const locator of candidates) {
    const visible: Locator[] = [];
    for (let index = 0, count = await locator.count(); index < count; index++) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) visible.push(candidate);
    }
    if (visible.length === 1) return visible[0]!;
    if (visible.length > 1) throw new Error('Ambiguous route controls are visible.');
  }
  return null;
}

async function routeInput(page: Page, kind: 'pickup' | 'destination'): Promise<Locator | null> {
  const name = kind === 'pickup' ? /pickup|pick-up|starting point|where from/i : /destination|drop-off|dropoff|where to/i;
  return uniqueVisible([
    page.getByRole('combobox', { name }), page.getByRole('textbox', { name }),
    page.getByLabel(name), page.getByPlaceholder(name),
  ]);
}

async function fillAddress(page: Page, input: Locator, address: string): Promise<void> {
  await input.fill(address, { timeout });
  // Autocomplete entries resolve geocoding. Only one exact textual match is safe.
  const options = page.getByRole('option');
  await options.first().waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
  const visibleOptions: Locator[] = [];
  for (let index = 0, count = await options.count(); index < count; index++) {
    const option = options.nth(index);
    if (!await option.isVisible()) continue;
    visibleOptions.push(option);
  }
  if (visibleOptions.length === 0) return;
  const matches: Locator[] = [];
  for (const option of visibleOptions) {
    if (addressesMatch(address, await option.innerText())) matches.push(option);
  }
  if (matches.length !== 1) throw new Error('The address has no unique exact autocomplete match. Use a complete street address.');
  await matches[0]!.click({ timeout });
}

async function readRouteSummary(page: Page): Promise<string> {
  const summary = await uniqueVisible([
    page.getByRole('region', { name: routeNames }), page.getByRole('group', { name: routeNames }),
  ]);
  // Editable address controls are request echoes, not independent provider proof.
  if (!summary || await summary.getAttribute('contenteditable') !== null || await summary.locator('input, textarea, select, [contenteditable], form').count()) return '';
  return summary.innerText({ timeout });
}

async function watchPriceUpdates(page: Page, key: string): Promise<void> {
  await page.evaluate(key => {
    const store = window as unknown as Record<string, { observer: MutationObserver; lastPriceChange: number }>;
    const domChecks = {
      isRegion(element: Element): boolean {
        const name = element.getAttribute('aria-label') ?? (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)
          .map(id => document.getElementById(id)?.textContent ?? '').join(' ');
        return (element.getAttribute('role') === 'region' || element.tagName === 'SECTION') &&
          /^(?:ride options|ride prices|available rides|ride estimates|ride results)$/i.test(name.trim());
      },
      inPriceRegion(node: Node): boolean {
        for (let element = node instanceof Element ? node : node.parentElement; element; element = element.parentElement) {
          if (this.isRegion(element)) return true;
        }
        return false;
      },
    };
    const state = { observer: null as unknown as MutationObserver, lastPriceChange: 0 };
    state.observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const nodes = mutation.type === 'characterData' ? [mutation.target] : [...mutation.addedNodes];
        for (const node of nodes) {
          if (!/\$\s*\d/.test(node.textContent ?? '')) continue;
          const addedRegions = node instanceof Element ? [node, ...node.querySelectorAll('section, [role="region"]')].filter(domChecks.isRegion) : [];
          if (domChecks.inPriceRegion(mutation.target) || addedRegions.some(region => /\$\s*\d/.test(region.textContent ?? ''))) {
            state.lastPriceChange = Date.now();
          }
        }
      }
    });
    state.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    store[key] = state;
  }, key);
}

async function waitForFreshPrices(page: Page, key: string): Promise<boolean> {
  try {
    await page.waitForFunction(key => {
      const state = (window as unknown as Record<string, { lastPriceChange: number }>)[key];
      return state && state.lastPriceChange > 0 && Date.now() - state.lastPriceChange >= 200;
    }, key, { timeout });
    return true;
  } catch { return false; }
}

function unavailable(provider: RideProvider, context: ProviderContext, message: string): CaptureResult {
  const quote: Quote = {
    id: randomUUID(), provider, sector: 'rides', status: 'unavailable', source: 'browser',
    label: `${provider === 'uber' ? 'Uber' : 'Lyft'} automatic comparison unavailable`,
    totalCents: null, currency: 'USD', capturedAt: new Date().toISOString(), expiresAt: null,
    etaMinutes: null, benefits: [], warnings: [message], evidence: '', requestFingerprint: context.fingerprint,
    error: message,
  };
  return { quotes: [quote], warnings: [message] };
}

/** Prepares a route and reads quotes. Never clicks request/booking/payment controls. */
export async function compareRidesAutomatically(
  provider: RideProvider, context: ProviderContext, request: RideRequest,
): Promise<CaptureResult> {
  const page = context.page;
  const watchKey = `rideQuoteWatch_${randomUUID()}`;
  let watchingPrices = false;
  let stage = 'open';
  try {
    if (!isAllowedRideUrl(provider, page.url())) {
      return unavailable(provider, context, 'Sign in to this provider in Connections before comparing.');
    }
    let pickup = await routeInput(page, 'pickup');
    let destination = await routeInput(page, 'destination');
    if (!pickup || !destination) {
      const text = await page.locator('body').innerText({ timeout });
      if (/sign in|log in|login|enter your phone|verify you are human|captcha/i.test(text)) {
        return unavailable(provider, context, 'Provider sign-in or human verification is required. Complete it in Connections, then compare again.');
      }
      await page.goto(entryUrls[provider], { waitUntil: 'domcontentloaded', timeout: 20_000 });
      pickup = await routeInput(page, 'pickup');
      destination = await routeInput(page, 'destination');
    }
    if (!pickup || !destination) return unavailable(provider, context, 'This provider route-entry layout is unsupported. No quote was captured.');
    stage = 'addresses';
    await fillAddress(page, pickup, request.pickup);
    // Re-resolve destination after autocomplete may replace the route form.
    destination = await routeInput(page, 'destination');
    if (!destination) return unavailable(provider, context, 'The destination control disappeared after resolving the pickup.');
    await fillAddress(page, destination, request.destination);
    stage = 'quotes';
    const search = await uniqueVisible([page.getByRole('button', { name: quoteControl })]);
    if (!search) return unavailable(provider, context, 'A supported price-search control was not found; booking was not attempted.');
    await watchPriceUpdates(page, watchKey);
    watchingPrices = true;
    await search.click({ timeout });
    if (!await waitForFreshPrices(page, watchKey)) {
      return unavailable(provider, context, 'The provider did not visibly refresh its ride prices after this search. Existing fares were rejected; try again.');
    }
    if (!isAllowedRideUrl(provider, page.url())) return unavailable(provider, context, 'Provider authentication interrupted the comparison. Sign in through Connections.');
    const priceRegion = await uniqueVisible([page.getByRole('region', { name: priceRegionNames })]);
    if (!priceRegion || await priceRegion.getAttribute('aria-busy') === 'true' || await priceRegion.locator('[aria-busy="true"], [role="progressbar"]').count()) {
      return unavailable(provider, context, 'The provider did not show a complete supported ride-price result region.');
    }
    const summaryText = await readRouteSummary(page);
    const text = await priceRegion.innerText({ timeout });
    await page.waitForTimeout(200);
    if (summaryText !== await readRouteSummary(page) || text !== await priceRegion.innerText({ timeout })) {
      return unavailable(provider, context, 'Provider route or fares changed during verification. Compare again after prices settle.');
    }
    const observed = parseResolvedRideRoute(summaryText);
    if (!observed || !addressesMatch(request.pickup, observed.pickup) || !addressesMatch(request.destination, observed.destination)) {
      return unavailable(provider, context, 'The provider did not show a resolved route matching both requested addresses. No comparable quote was accepted.');
    }
    const currencyEvidence = /\bUSD\b/i.test(text) ? 'USD' : /\bUS\$/i.test(text) ? 'US$' :
      isUsAddress(observed.pickup) && isUsAddress(observed.destination) ? 'observed-us-addresses' : null;
    if (!currencyEvidence) {
      return unavailable(provider, context, 'The provider did not establish USD currency through an explicit label or resolved U.S. addresses. No verified quote was accepted.');
    }
    const parsed = parseVisibleRideFares(provider, text, 'USD');
    const currencyWarnings = parsed.warnings.map(warning => warning === 'USD assumed for U.S. pilot; confirm currency on the provider page.' ?
      'USD inferred from the provider\'s resolved U.S. pickup and destination addresses.' : warning);
    const standard = parsed.fares.filter(fare => provider === 'uber' ? /^UberX$/i.test(fare.label) : /^(?:Lyft|Standard)$/i.test(fare.label));
    const eligible = standard.filter(fare => {
      const capacity = readRideCapacity(fare.evidence);
      return capacity !== null && capacity >= request.passengers;
    });
    if (eligible.length !== 1) return unavailable(provider, context, 'No single standard ride quote with verified passenger capacity was visible.');
    const fare = eligible[0]!;
    const capacity = readRideCapacity(fare.evidence)!;
    const url = new URL(page.url());
    const quote: Quote = {
      id: randomUUID(), provider, sector: 'rides', status: 'verified', source: 'browser', verification: 'automatic',
      label: fare.label, totalCents: fare.totalCents, currency: 'USD', capturedAt: new Date().toISOString(),
      expiresAt: null, etaMinutes: fare.etaMinutes, benefits: [],
      warnings: [
        'Provider quote expiry is unknown. Refresh before booking; the fare may change.',
        'Displayed provider fare; any later adjustments or charges outside the quote are not verified.',
        ...currencyWarnings, ...fare.warnings,
      ],
      evidence: fare.evidence, requestFingerprint: context.fingerprint, checkoutUrl: `${url.origin}${url.pathname}`,
      observedContext: {
        kind: 'rides', source: 'provider_dom', pickup: observed.pickup, destination: observed.destination,
        serviceClass: 'standard', category: fare.label, capacity,
        shared: /\b(?:shared|pool|share)\b/i.test(fare.evidence.replace(/\bnon[- ]shared\b/gi, 'private')),
        evidence: `${observed.evidence}\n${fare.evidence}`,
        currencyEvidence,
      },
    };
    const verificationError = verifyQuoteContext(quote, request);
    if (verificationError) return unavailable(provider, context, verificationError);
    return { quotes: [quote], warnings: currencyWarnings };
  } catch {
    const messages: Record<string, string> = {
      open: 'The provider could not be opened. Check the connection and supported browser layout.',
      addresses: 'The addresses could not be resolved uniquely. Use complete addresses and reconnect if sign-in is required.',
      quotes: 'The provider did not return a supported current quote. Check sign-in, availability, or try again.',
    };
    return unavailable(provider, context, messages[stage]!);
  } finally {
    if (watchingPrices) await page.evaluate(key => {
      const store = window as unknown as Record<string, { observer: MutationObserver }>;
      store[key]?.observer.disconnect();
      delete store[key];
    }, watchKey).catch(() => {});
  }
}
