import { randomUUID } from 'node:crypto';
import type { CaptureResult, ProviderContext, Quote, RideRequest } from '../domain.js';

type RideProvider = 'uber' | 'lyft';
export interface VisibleRideFare {
  label: string;
  totalCents: number;
  evidence: string;
  etaMinutes: number | null;
  warnings: string[];
}

const providerDomains: Record<RideProvider, string> = {
  uber: 'uber.com',
  lyft: 'lyft.com',
};

// Exact category lines prevent a restaurant, advertisement, or arbitrary dollar
// amount from becoming a ride quote. Extend this list only with observed UI labels.
const categories: Record<RideProvider, RegExp> = {
  uber: /^(?:UberX Share|UberX|UberXL|Uber Green|Green|Comfort Electric|Comfort|Black SUV|Black|Premier SUV|Premier|Uber WAV|WAV|Uber Pet|Pet|Uber Taxi|Taxi|Uber Assist|Assist)$/i,
  lyft: /^(?:Lyft XL|Lyft|Standard|Wait & Save|Priority Pickup|Extra Comfort|XL|Black SUV|Black|Lux Black XL|Lux Black|Lux|Green|Access)$/i,
};
const foreignCurrency = /[€£₹¥₩₽₺₫฿₱]|\b(?:CAD|AUD|NZD|HKD|SGD|MXN|EUR|GBP|INR|JPY|CNY|RMB|BRL|CHF|KRW|AED|SAR|SEK|NOK|DKK|ZAR|IDR|MYR|THB|PHP)\b|\b(?:CA|C|AU|A|NZ|HK|SG|S|MX|R)\$/i;
const amountPattern = /\$(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d.,])/g;
const unrelatedContext = /\b(?:account|wallet|credit|gift card|receipt|past trip|trip history|tip|cancellation fee|subscription|membership|no cars|unavailable|not available|sold out)\b/i;

export function isAllowedRideUrl(provider: RideProvider, value: string): boolean {
  try {
    const url = new URL(value);
    const domain = providerDomains[provider];
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.port === '' || url.port === '443') &&
      (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function readCategory(line: string, provider: RideProvider): string | null {
  // Accept a standalone category or a category followed directly by its fare.
  const label = line.replace(/\s+(?:USD\s*|US)?\$.*$/, '').trim();
  return categories[provider].test(label) ? label : null;
}

/** Only explicitly destination/total-trip times qualify for fastest-arrival ranking. */
export function parseRideTiming(evidence: string): { etaMinutes: number | null; warnings: string[] } {
  const destinationLabelPattern = /\b(?:arriv(?:e|es|al) at (?:the )?destination in|total trip time)\b/gi;
  const destinationPattern = /\b(?:arriv(?:e|es|al) at (?:the )?destination in|total trip time\s*:?)\s*(\d+)\s*(?:min(?:ute)?s?)\b(?!\s*(?:[-–—+]|\bto\b))/gi;
  const arrivalTimes = [...evidence.matchAll(destinationPattern)]
    .map(match => Number(match[1]))
    .filter(value => Number.isSafeInteger(value) && value >= 0);
  const uniqueTimes = [...new Set(arrivalTimes)];
  const warnings: string[] = [];
  const incomplete = [...evidence.matchAll(destinationLabelPattern)].length !== arrivalTimes.length;
  if (incomplete) warnings.push('An incomplete or ranged destination arrival estimate is visible; destination ETA is unknown.');
  if (uniqueTimes.length > 1) warnings.push('Conflicting destination arrival estimates are visible; destination ETA is unknown.');
  const pickupPattern = /\b(?:pickup|pick-up|driver arrival|car arrival)\s*(?:in|:)\s*(\d+)\s*(?:min(?:ute)?s?)\b/gi;
  for (const match of evidence.matchAll(pickupPattern)) {
    warnings.push(`Pickup estimate: ${match[1]} min (not destination arrival).`);
  }
  const genericArrivalPattern = /\barriv(?:e|es) in\s*(\d+)\s*(?:min(?:ute)?s?)\b/gi;
  for (const match of evidence.matchAll(genericArrivalPattern)) {
    warnings.push(`Displayed "Arrives in" estimate: ${match[1]} min (not verified destination arrival).`);
  }
  return { etaMinutes: !incomplete && uniqueTimes.length === 1 ? uniqueTimes[0]! : null, warnings };
}

/** Parse rendered text only. Missing, ranged, or competing amounts are not fares. */
export function parseVisibleRideFares(provider: RideProvider, visibleText: string, expectedCurrency?: 'USD'): {
  fares: VisibleRideFare[]; warnings: string[];
} {
  if (foreignCurrency.test(visibleText)) {
    return { fares: [], warnings: ['Non-USD currency is visible; this capture supports USD only.'] };
  }
  const explicitUsd = /\bUSD\b|\bUS\$/i.test(visibleText);
  if (/\$/.test(visibleText) && !explicitUsd && expectedCurrency !== 'USD') {
    return { fares: [], warnings: ['Currency is unknown: a dollar symbol alone does not establish USD.'] };
  }
  const lines = visibleText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const fares: VisibleRideFare[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const firstLine = lines[index]!;
    const label = readCategory(firstLine, provider);
    if (!label) continue;
    let end = index + 1;
    // Bound the association: don't attach a distant footer price to a category.
    while (end < lines.length && end < index + 8 && !readCategory(lines[end]!, provider)) end++;
    const evidence = lines.slice(index, end).join('\n');
    const matches = [...evidence.matchAll(amountPattern)];
    const malformedAmount = /\$\d[\d,]*(?:\.\d{3,}|\.(?!\d))|\$\s+\d/.test(evidence);
    const rangedOrUnitPrice = /\$[^\n]*?(?:[-–—]\s*\$?\d|\bto\s*\$?\d|\+)|(?:\b(?:from|starting at|up to|approximately|about)|[~≈])\s*(?:USD\s*)?\$|\$[^\n]*(?:\/\s*(?:mi|mile|min|minute|km)|per\s+(?:mile|minute|km))/i.test(evidence);
    if (matches.length !== 1 || malformedAmount || rangedOrUnitPrice || unrelatedContext.test(evidence)) {
      if (matches.length || /\$/.test(evidence)) warnings.push(`${label}: no unambiguous exact fare was captured.`);
      continue;
    }
    const raw = matches[0]![1]!.replaceAll(',', '');
    const [whole, fraction = ''] = raw.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      warnings.push(`${label}: the displayed fare is invalid or zero.`);
      continue;
    }
    fares.push({ label, totalCents: cents, evidence, ...parseRideTiming(evidence) });
  }
  if (fares.length && !explicitUsd) {
    warnings.push('USD assumed for U.S. pilot; confirm currency on the provider page.');
  }
  return { fares, warnings };
}

function baseQuote(provider: RideProvider, context: ProviderContext): Quote {
  return {
    id: randomUUID(), provider, sector: 'rides', source: 'browser',
    status: 'unavailable', label: `${provider === 'uber' ? 'Uber' : 'Lyft'} quote unavailable`,
    totalCents: null, currency: 'USD', capturedAt: new Date().toISOString(),
    expiresAt: null, etaMinutes: null, benefits: [], warnings: [], evidence: '',
    requestFingerprint: context.fingerprint,
  };
}

/** Reads the current provider page; never fills fields, clicks, navigates or books. */
export async function captureRides(
  provider: RideProvider, context: ProviderContext, request: RideRequest,
): Promise<CaptureResult> {
  const unavailable = (message: string): CaptureResult => ({
    quotes: [{ ...baseQuote(provider, context), warnings: [message], error: message }],
    warnings: [message],
  });
  try {
    const currentUrl = context.page.url();
    if (!isAllowedRideUrl(provider, currentUrl)) {
      return unavailable('Open the connected provider on an allowed HTTPS origin before capturing.');
    }
    const visibleText = await context.page.locator('body').innerText({ timeout: 10_000 });
    if (context.page.url() !== currentUrl) {
      return unavailable('The provider page changed during capture. Capture again.');
    }
    const parsed = parseVisibleRideFares(provider, visibleText, context.expectedCurrency);
    if (parsed.fares.length === 0) {
      const result = unavailable('No complete, unambiguous USD ride fare is visible. Configure the journey in the provider tab and capture again.');
      result.warnings.push(...parsed.warnings);
      result.quotes[0]!.warnings.push(...parsed.warnings);
      return result;
    }
    const confirmation = `Confirm that the displayed journey is ${request.pickup} to ${request.destination}, with capacity for ${request.passengers} passenger(s), and that the compared vehicle categories are equivalent.`;
    const warnings = [
      confirmation,
      'Provider quote expiry is unknown. Refresh before booking; the fare may change.',
      'Account benefits and any charges outside the displayed fare are not verified. Destination ETA is available only when explicitly labeled on the provider page.',
      'Confirm the displayed currency is USD before accepting this quote.',
    ];
    const url = new URL(currentUrl);
    // Do not store session-related query parameters or fragments in quote records.
    const checkoutUrl = `${url.origin}${url.pathname}`;
    return {
      quotes: parsed.fares.map(fare => ({
        ...baseQuote(provider, context), ...fare, status: 'needs_confirmation',
        warnings: [...warnings, ...parsed.warnings, ...fare.warnings], checkoutUrl,
      })),
      warnings: parsed.warnings,
    };
  } catch {
    // Browser errors can contain sensitive URLs. Return a fixed actionable message.
    return unavailable('Could not read the provider page. Reopen the connected browser and capture again.');
  }
}
