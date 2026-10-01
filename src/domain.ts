export const providers = ['uber', 'lyft', 'ubereats', 'doordash'] as const;
export type Provider = (typeof providers)[number];
export type Sector = 'rides' | 'eats';
export type QuoteStatus = 'verified' | 'needs_confirmation' | 'unavailable';
export interface RideRequest {
  pickup: string; destination: string; passengers: number;
}
export interface FoodRequest {
  address: string; restaurant: string;
  items: {name: string; quantity: number; notes?: string}[];
  tipCents: number;
}
export interface Quote {
  id: string; provider: Provider; sector: Sector; status: QuoteStatus;
  source: 'browser' | 'api' | 'manual'; label: string;
  totalCents: number | null; currency: 'USD'; capturedAt: string;
  expiresAt: string | null; etaMinutes: number | null;
  breakdown?: {subtotalCents?: number; taxCents?: number; serviceFeeCents?: number; deliveryFeeCents?: number; tipCents?: number; discountCents?: number};
  benefits: string[]; warnings: string[]; evidence: string; checkoutUrl?: string;
  requestFingerprint: string; error?: string;
}
export interface CaptureResult {
  quotes: Quote[]; warnings: string[];
}
export interface ProviderState {
  provider: Provider; status: 'not_connected' | 'browser_open' | 'ready' | 'error';
  url?: string; message?: string; updatedAt?: string;
}
export interface ProviderContext {
  page: import('playwright').Page;
  fingerprint: string;
  expectedCurrency?: 'USD';
}
export interface Comparison {
  id: string; fingerprint: string; sector: Sector;
  request: RideRequest | FoodRequest; quotes: Quote[]; warnings: string[]; createdAt: string;
  ranking: {cheapest: Quote | null; fastest: Quote | null; eligibleCount: number; excludedCount: number};
}
