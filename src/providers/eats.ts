import { randomUUID } from 'node:crypto';
import type { CaptureResult, FoodRequest, ProviderContext, Quote } from '../domain.js';

type EatsProvider = 'ubereats' | 'doordash';
type Breakdown = NonNullable<Quote['breakdown']>;
export interface ParsedEatsCheckout {
  totalCents: number | null;
  breakdown: Breakdown;
  etaMinutes: number | null;
  benefits: string[];
  warnings: string[];
  evidence: string;
  checkout: boolean;
}

const money = /^(?:(?:US\$|USD\s*\$?|\$)\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})|(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s*USD)$/i;
const fields: [keyof Breakdown | 'total', RegExp][] = [
  ['total', /^(?:total|order total|grand total)(?:\s*\(USD\))?$/i],
  ['subtotalCents', /^subtotal$/i],
  ['taxCents', /^(?:tax|taxes|sales tax)$/i],
  ['serviceFeeCents', /^service fee$/i],
  ['deliveryFeeCents', /^delivery fee$/i],
  ['tipCents', /^(?:tip|driver tip|courier tip|dasher tip)$/i],
  ['discountCents', /^(?:discount|discounts|applied discount|promo discount|coupon discount)$/i],
];

function cents(value: string): number | null {
  const clean = value.replaceAll(',', '');
  const negative = clean.startsWith('-');
  const [whole, fraction] = clean.replace(/^-/, '').split('.');
  const result = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(result) ? (negative ? -result : result) : null;
}

/** Parse only explicit visible checkout labels. No inferred prices or basket matching. */
export function parseEatsCheckoutText(text: string, options: { expectedCurrency?: 'USD' } = {}): ParsedEatsCheckout {
  const lines = text.split(/\r?\n/).map(line => line.replace(/\u00a0/g, ' ').trim()).filter(Boolean);
  const checkout = lines.some(line => /^(?:checkout|review (?:your )?order|place (?:your )?order|confirm (?:your )?order)$/i.test(line));
  const warnings: string[] = [];
  const evidence: string[] = [];
  const values = new Map<keyof Breakdown | 'total', number[]>();
  let invalidTotal = false;
  const foreignCurrency = /(?:\b(?:CAD|AUD|NZD|EUR|GBP|JPY|CNY|INR|MXN|BRL|CHF|HKD|SGD)\b|CA\$|C\$|A\$|NZ\$|[€£¥₹])/i.test(text);
  // Dollar signs alone need an explicit U.S. pilot context and user confirmation.
  const explicitUsd = /(?:\bUSD\b|US\$|U\.S\. dollars|US dollars)/i.test(text);
  const currencyValid = (explicitUsd || options.expectedCurrency === 'USD') && !foreignCurrency;
  if (!currencyValid) warnings.push(foreignCurrency ? 'Unsupported or conflicting currency; only explicitly identified USD prices are accepted.' : 'Currency is unverified: an unqualified dollar sign does not establish USD.');
  else if (!explicitUsd) warnings.push('USD assumed for U.S. pilot; confirm currency on the provider page.');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    for (const [key, label] of fields) {
      let amountText: string | undefined;
      let displayLabel: string | undefined;
      if (label.test(line)) {
        amountText = lines[index + 1];
        displayLabel = line;
      } else {
        // Split only at a monetary amount; labels must match in full.
        const split = line.match(/^(.*?)(?:\s*:\s*|\s+(?=(?:US\$|USD|\$|-?\d)))(.+)$/i);
        if (split && label.test(split[1]!.replace(/:$/, '').trim())) {
          displayLabel = split[1]!.replace(/:$/, '').trim();
          amountText = split[2];
        }
      }
      if (!amountText || !displayLabel) {
        if (key === 'total' && displayLabel) invalidTotal = true;
        continue;
      }
      const match = amountText.match(money);
      if (!match) {
        if (key === 'total') {
          invalidTotal = true;
          warnings.push('The displayed final total is missing or ambiguous.');
        }
        continue;
      }
      const value = cents((match[1] ?? match[2])!);
      if (value === null || (key !== 'discountCents' && value < 0)) {
        if (key === 'total') invalidTotal = true;
        warnings.push(`Invalid ${displayLabel.toLowerCase()} amount.`);
        continue;
      }
      const normalizedValue = key === 'discountCents' ? Math.abs(value) : value;
      values.set(key, [...(values.get(key) ?? []), normalizedValue]);
      evidence.push(`${displayLabel}: ${amountText}`);
    }
  }

  function unique(key: keyof Breakdown | 'total'): number | undefined {
    const candidates = [...new Set(values.get(key) ?? [])];
    if (candidates.length > 1) warnings.push(`Conflicting ${key === 'total' ? 'final total' : key} amounts; this field is unknown.`);
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  const breakdown: Breakdown = {};
  for (const [key] of fields) {
    if (key === 'total') continue;
    const value = unique(key);
    if (value !== undefined && currencyValid && checkout) breakdown[key] = value;
  }
  const finalTotal = unique('total');
  let totalCents = checkout && currencyValid && !invalidTotal ? finalTotal ?? null : null;
  if (!checkout) warnings.push('No supported checkout is visible. Open the provider checkout yourself; this capture does not create or modify carts.');
  if (finalTotal === undefined) warnings.push('No unambiguous final total is visible; subtotal and item prices cannot substitute for it.');
  if (totalCents !== null && breakdown.subtotalCents !== undefined && totalCents < breakdown.subtotalCents - (breakdown.discountCents ?? 0)) {
    warnings.push('The displayed total conflicts with the available subtotal and discount; price is unavailable.');
    totalCents = null;
  }
  const completeBreakdown = ['subtotalCents', 'taxCents', 'serviceFeeCents', 'deliveryFeeCents', 'tipCents', 'discountCents'] as const;
  if (totalCents !== null && completeBreakdown.every(key => breakdown[key] !== undefined)) {
    const expected = breakdown.subtotalCents! + breakdown.taxCents! + breakdown.serviceFeeCents! + breakdown.deliveryFeeCents! + breakdown.tipCents! - breakdown.discountCents!;
    if (expected !== totalCents) {
      warnings.push('The complete displayed price breakdown does not reconcile with the final total; price is unavailable.');
      totalCents = null;
    }
  }

  const benefits: string[] = [];
  if (checkout && currencyValid && breakdown.discountCents !== undefined && breakdown.discountCents > 0) benefits.push(`Visible applied discount: USD ${(breakdown.discountCents / 100).toFixed(2)}; eligibility was not independently verified.`);
  for (const line of lines) {
    const member = line.match(/^(DashPass|Uber One)\s+(delivery fee|service fee|discount|benefit)\s+(?:discount\s+)?applied\.?$/i);
    if (checkout && member) {
      const benefit = `${member[1]} ${member[2]} applied`;
      benefits.push(benefit);
      evidence.push(benefit);
    }
  }
  let etaMinutes: number | null = null;
  const arrivals: number[] = [];
  for (const line of lines) {
    const arrival = line.match(/^(?:estimated arrival|estimated delivery|arrives in|delivery in)\s*:?\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*(?:min|mins|minutes)$/i);
    if (!arrival) continue;
    const low = Number(arrival[1]);
    const high = Number(arrival[2] ?? arrival[1]);
    if (low > high || high > 240) continue;
    arrivals.push(high);
    evidence.push(`Estimated delivery: ${low === high ? high : `${low}–${high}`} minutes`);
  }
  if (checkout && arrivals.length === 1) etaMinutes = arrivals[0]!;
  if (arrivals.length > 1) warnings.push('Multiple arrival estimates are visible; arrival time is unknown.');
  if (arrivals.length === 1 && evidence.some(line => /^Estimated delivery:.*–/.test(line))) warnings.push('Arrival is a provider estimate; the upper end of the displayed range is used.');
  return { totalCents, breakdown, etaMinutes, benefits: [...new Set(benefits)], warnings: [...new Set(warnings)], evidence: [...new Set(evidence)].join('\n'), checkout };
}

export function isOfficialEatsUrl(provider: EatsProvider, input: string): boolean {
  try {
    const url = new URL(input);
    const domain = provider === 'ubereats' ? 'ubereats.com' : 'doordash.com';
    const officialHost = url.hostname === domain || url.hostname.endsWith(`.${domain}`);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && officialHost;
  } catch { return false; }
}

export async function captureEats(provider: EatsProvider, context: ProviderContext, request: FoodRequest): Promise<CaptureResult> {
  const confirmation = 'Confirm the exact restaurant branch, items, quantities, modifiers, delivery address, and tip before ranking this quote.';
  const base: Quote = {
    id: randomUUID(), provider, sector: 'eats', status: 'unavailable', source: 'browser',
    label: `${provider === 'ubereats' ? 'Uber Eats' : 'DoorDash'} visible checkout`,
    totalCents: null, currency: 'USD', capturedAt: new Date().toISOString(), expiresAt: null,
    etaMinutes: null, benefits: [], warnings: [confirmation], evidence: '', requestFingerprint: context.fingerprint,
  };
  function unavailable(message: string): CaptureResult {
    base.warnings.push(message);
    base.error = message;
    return { quotes: [base], warnings: [...base.warnings] };
  }
  const before = context.page.url();
  if (!isOfficialEatsUrl(provider, before)) return unavailable('Open the official HTTPS provider website. The current page origin is unsupported.');
  try {
    const text = await context.page.locator('body').innerText({ timeout: 8_000 });
    const after = context.page.url();
    if (!isOfficialEatsUrl(provider, after) || before !== after) return unavailable('The page changed during capture; open a stable official checkout and try again.');
    const parsed = parseEatsCheckoutText(text, { expectedCurrency: context.expectedCurrency });
    base.capturedAt = new Date().toISOString();
    base.totalCents = parsed.totalCents;
    base.breakdown = parsed.breakdown;
    base.etaMinutes = parsed.etaMinutes;
    base.benefits = parsed.benefits;
    base.evidence = parsed.evidence;
    base.warnings.push(...parsed.warnings);
    const safeUrl = new URL(after);
    safeUrl.search = '';
    safeUrl.hash = '';
    base.checkoutUrl = safeUrl.toString();
    if (!parsed.checkout && /\b(?:sign in|log in|login)\b/i.test(text)) base.warnings.push('Sign in yourself in the provider browser, then open checkout.');
    if (parsed.breakdown.tipCents === undefined) base.warnings.push('The displayed tip is unknown; verify it matches the requested tip.');
    else if (parsed.breakdown.tipCents !== request.tipCents) {
      base.warnings.push(`Displayed tip USD ${(parsed.breakdown.tipCents / 100).toFixed(2)} differs from requested tip USD ${(request.tipCents / 100).toFixed(2)}. Update the provider checkout yourself and capture again.`);
      base.totalCents = null;
      base.error = 'The explicit checkout tip does not match the requested tip.';
    }
    if (base.totalCents !== null) base.status = 'needs_confirmation';
    else if (!base.error) base.error = 'A complete, unambiguous USD checkout total is unavailable.';
    return { quotes: [base], warnings: [...base.warnings] };
  } catch {
    return unavailable('Could not read the visible checkout. Reopen the provider page and try again.');
  }
}
