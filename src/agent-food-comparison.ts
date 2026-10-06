import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {z} from 'zod';
import {addressesMatch,isUsAddress,verifyQuoteContext} from './verification.js';
import type {FoodRequest,Quote} from './domain.js';

const text=z.string().trim().min(1).max(300);
const address=z.string().trim().min(8).max(300);
const cents=z.number().int().min(0).max(1000000);
const provider=z.enum(['ubereats','doordash']);
const item=z.object({
  name:text,quantity:z.number().int().min(1).max(20),
  notes:z.string().trim().max(1000).default(''),
  modifiers:z.array(z.object({group:text,option:text}).strict()).max(20).default([]),
}).strict();
export const foodPlanSchema=z.object({
  address,restaurant:text,restaurantAddress:address,items:z.array(item).min(1).max(30),
  tipCents:cents,deliverySpeed:z.literal('standard').default('standard'),
  providers:z.array(provider).length(2).refine(p=>new Set(p).size===2,'Select Uber Eats and DoorDash once each').default(['ubereats','doordash']),
  priority:z.enum(['cheapest','quickest']).default('cheapest'),
}).strict();
const currencyContext=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('explicit_currency'),evidence:z.string().trim().min(2).max(1000)}).strict(),
  z.object({kind:z.literal('us_checkout'),countryCode:z.literal('US'),countryEvidence:z.string().trim().min(2).max(1000),priceEvidence:z.string().trim().min(2).max(1000)}).strict(),
  z.object({kind:z.literal('us_addresses')}).strict(),
]);
const observed=z.object({
  provider,status:z.literal('observed'),source:z.enum(['provider_page','connected_tool']).default('provider_page'),
  sourceUrl:z.string().url().max(1000),capturedAt:z.string().datetime(),
  address,restaurant:text,restaurantAddress:address,items:z.array(item).min(1).max(30),
  deliverySpeed:z.literal('standard'),tipCents:cents,currencyContext,
  totalCents:cents,totalIncludesTip:z.boolean(),totalEvidence:z.string().trim().min(3).max(1000),
  breakdown:z.object({subtotalCents:cents.nullable(),taxCents:cents.nullable(),deliveryFeeCents:cents.nullable(),serviceFeeCents:cents.nullable(),otherFeesCents:cents.nullable(),discountCents:cents.nullable()}).strict(),
  etaMinutesMin:z.number().min(0).max(1440).nullable(),etaMinutesMax:z.number().min(0).max(1440).nullable(),
  etaEvidence:z.string().trim().max(1000),
  benefits:z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  evidence:z.string().trim().min(10).max(6000),
}).strict();
const unavailable=z.object({provider,status:z.literal('unavailable'),reason:z.string().trim().min(1).max(1000)}).strict();
export const foodFinishSchema=z.object({comparisonId:z.string().min(40).max(1000000),observations:z.array(z.discriminatedUnion('status',[observed,unavailable])).min(1).max(2)}).strict();
type FoodObservation=z.infer<typeof observed>;
const lifetime=15*60*1000;

function foodAddressMatches(expected:string,seen:string):boolean {
  if(addressesMatch(expected,seen)) return true;
  // A checkout may omit a ZIP while displaying the same street, unit, city and
  // state. Allow that omission, but never conflicting ZIPs or missing units.
  if(isUsAddress(expected)===isUsAddress(seen)) return false;
  const withoutZip=(value:string)=>value.replace(/\b([A-Z]{2})[\s,]+\d{5}(?:[-\s]\d{4})?(?=(?:[\s,]+(?:United States(?: of America)?|USA|US))?\s*$)/i,'$1');
  return addressesMatch(withoutZip(expected),withoutZip(seen));
}

function currencyReason(o:FoodObservation):string|null {
  const foreign=/\b(?:CAD|AUD|NZD|SGD|HKD|EUR|GBP|INR|MXN)\b|(?:CA|AU|NZ|SG|HK)\$/i;
  if(foreign.test(o.totalEvidence)) return 'The final total shows a foreign currency; collect a USD checkout quote.';
  const c=o.currencyContext;
  if(c.kind==='explicit_currency') return /\bUSD\b|US\$/i.test(c.evidence)&&!foreign.test(c.evidence)?null:'Collect an explicit USD/US$ checkout label; a plain dollar sign is not enough.';
  if(c.kind==='us_addresses') return isUsAddress(o.address)&&isUsAddress(o.restaurantAddress)?null:'U.S. address evidence requires both observed addresses with state and ZIP; otherwise collect explicit USD or provider U.S. country context.';
  const usCountry=/\bunited states(?: of america)?\b|\busa\b|\bcountry\s*[:=]?\s*us\b/i.test(c.countryEvidence);
  const state=/\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|PR)(?:\s+\d{5}(?:-\d{4})?)?(?:,?\s+(?:United States(?: of America)?|USA|US))?\s*$/i;
  return usCountry&&state.test(o.address)&&state.test(o.restaurantAddress)&&/\$\s*\d/.test(c.priceEvidence)&&!foreign.test(c.countryEvidence+' '+c.priceEvidence)?null:'Collect observed U.S. country context and dollar pricing, plus the state in both provider addresses. Do not infer country from the requested address.';
}
function observationReason(o:FoodObservation,request:z.infer<typeof foodPlanSchema>,createdAt:number,now:number):string|null {
  const url=new URL(o.sourceUrl),domain=o.provider==='ubereats'?'ubereats.com':'doordash.com';
  if(url.protocol!=='https:'||!(url.hostname===domain||url.hostname.endsWith('.'+domain))||url.username||url.password||url.search||url.hash||/^(?:auth|identity|account)\./.test(url.hostname)) return 'Expected a clean official HTTPS provider quote URL, excluding authentication pages, credentials and query parameters.';
  const captured=Date.parse(o.capturedAt);
  if(captured<createdAt||captured>now+15000||now-captured>=lifetime) return 'Quote is stale, predates this comparison, or has a future capture time. Refresh it.';
  const currency=currencyReason(o);if(currency) return currency;
  if(!foodAddressMatches(request.address,o.address)) return 'Provider delivery address does not match the request.';
  if(!foodAddressMatches(request.restaurantAddress,o.restaurantAddress)) return 'Provider restaurant branch does not match the requested branch.';
  // Currency is checked above, then reuse the original exact-basket validator.
  const quote={provider:o.provider,sector:'eats',observedContext:{kind:'eats',source:o.source==='connected_tool'?'provider_api':'provider_dom',restaurant:o.restaurant,restaurantAddress:o.restaurantAddress,address:o.address,items:o.items,deliverySpeed:o.deliverySpeed,tipCents:o.tipCents,currencyEvidence:'USD',evidence:o.evidence}} as Quote;
  const context=verifyQuoteContext(quote,{...request,address:o.address,restaurantAddress:o.restaurantAddress} as FoodRequest);if(context) return context;
  if(!o.totalIncludesTip) return 'The quoted total must include the common requested tip.';
  // Associate the label with the first monetary amount on that same line. A
  // matching subtotal elsewhere must not disguise a different final total.
  const totalLines=o.totalEvidence.match(/\b(?:total|you(?:'|’)ll pay|amount due|pay now)\b[^\r\n]{0,150}/ig)??[];
  const totalMatches=totalLines.some(line=>{
    const amount=line.replace(/,/g,'').match(/(?:US\$|\$|USD)\s*(\d+\.\d{2})(?!\d)|(\d+\.\d{2})\s*(?:USD|US\$)(?!\w)/i);
    return amount!==null&&Math.round(Number(amount[1]??amount[2])*100)===o.totalCents;
  });
  if(!totalMatches) return 'Collect the displayed final checkout total label and matching amount; menu prices and subtotals are insufficient.';
  const b=o.breakdown;
  if(Object.values(b).every(n=>n!==null)) {
    const calculated=b.subtotalCents!+b.taxCents!+b.deliveryFeeCents!+b.serviceFeeCents!+b.otherFeesCents!+o.tipCents-b.discountCents!;
    if(calculated!==o.totalCents) return 'The final total conflicts with the complete observed fee, discount and tip breakdown.';
  }
  if((o.etaMinutesMin===null)!==(o.etaMinutesMax===null)||o.etaMinutesMin!==null&&(o.etaMinutesMax!<o.etaMinutesMin||!o.etaEvidence.trim())) return 'Submit both ends of an observed delivery window with its evidence, or leave both unknown.';
  return null;
}

/** Anonymous quote computation. Plans are encrypted client-held tokens; no carts or accounts are accessed. */
export class AgentFoodComparisons {
  private key=randomBytes(32);
  constructor(private now:()=>number=Date.now) {}
  prepare(input:unknown) {
    const request=foodPlanSchema.parse(input),now=this.now(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify({request,createdAt:now}),'utf8'),cipher.final()]);
    return {comparisonId:Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64url'),request,expiresAt:new Date(now+lifetime).toISOString(),
      providers:[{provider:'ubereats',url:'https://www.ubereats.com/'},{provider:'doordash',url:'https://www.doordash.com/'}],
      collect:['independently observed merchant and exact branch','delivery address','all items, quantities, modifiers and notes','standard delivery and common tip','final checkout total including tip','explicit USD, complete U.S. addresses, or observed provider U.S. country context','fee and discount breakdown (unknown fields stay null)','delivery window and evidence','applied benefits only','source URL, fresh capture time and minimal evidence'],
      instructions:'Check BOTH Uber Eats and DoorDash for this exact basket using authorized connected tools when they expose checkout data, otherwise the host browser. Preserve existing unrelated carts. Resume sign-in only when necessary. Never submit an order, pay, change payment details or invent missing information. Submit both results once to finish_food_comparison. Native provider access is not supplied by this MCP.',
      evidencePolicy:'Agent-reported page or connected-tool observations; Switchboard checks consistency, not independent source authenticity.'};
  }
  finish(input:unknown) {
    const {comparisonId,observations}=foodFinishSchema.parse(input),now=this.now();
    let plan:{request:z.infer<typeof foodPlanSchema>;createdAt:number};
    try {
      const token=Buffer.from(comparisonId,'base64url');if(token.toString('base64url')!==comparisonId) throw new Error('Invalid encoding');
      const decipher=createDecipheriv('aes-256-gcm',this.key,token.subarray(0,12));decipher.setAuthTag(token.subarray(12,28));
      plan=z.object({request:foodPlanSchema,createdAt:z.number().finite()}).parse(JSON.parse(Buffer.concat([decipher.update(token.subarray(28)),decipher.final()]).toString('utf8')));
    } catch {throw new Error('Food comparison expired or unknown. Prepare a fresh comparison.');}
    if(now-plan.createdAt>=lifetime||plan.createdAt>now) throw new Error('Food comparison expired or unknown. Prepare a fresh comparison.');
    if(new Set(observations.map(o=>o.provider)).size!==observations.length) throw new Error('Duplicate provider observations are not allowed.');
    const accepted:FoodObservation[]=[],excluded:{provider:string;reason:string}[]=[];
    for(const o of observations) {
      const reason=o.status==='unavailable'?o.reason:observationReason(o,plan.request,plan.createdAt,now);
      if(reason) excluded.push({provider:o.provider,reason});else if(o.status==='observed') accepted.push(o);
    }
    for(const p of plan.request.providers) if(!observations.some(o=>o.provider===p)) excluded.push({provider:p,reason:'No checkout observation supplied.'});
    const comparable=accepted.length===2;
    const [a,b]=accepted;
    const cheapest=comparable&&a!.totalCents!==b!.totalCents?(a!.totalCents<b!.totalCents?a!.provider:b!.provider):null;
    const timed=comparable&&accepted.every(o=>o.etaMinutesMin!==null&&o.etaMinutesMax!==null);
    const fastest=timed?(a!.etaMinutesMax!<b!.etaMinutesMin!?a!.provider:b!.etaMinutesMax!<a!.etaMinutesMin!?b!.provider:null):null;
    const overlap=timed&&fastest===null;
    const priceDifferenceCents=comparable?Math.abs(a!.totalCents-b!.totalCents):null;
    return {comparisonId,status:comparable?'comparable':'incomplete',request:plan.request,quotes:accepted,excluded,
      ranking:{cheapest,fastest},ties:{price:comparable&&cheapest===null,delivery:timed&&a!.etaMinutesMin===b!.etaMinutesMin&&a!.etaMinutesMax===b!.etaMinutesMax},
      deliveryEstimatesOverlap:overlap,priceDifferenceCents,
      recommendation:comparable?{provider:plan.request.priority==='cheapest'?cheapest:fastest,basis:plan.request.priority,reason:plan.request.priority==='cheapest'?(cheapest?'Lowest observed final checkout total including the common tip.':'The observed totals are tied.'):(fastest?'The observed delivery windows do not overlap; this provider has the earlier window.':timed?'Delivery windows overlap; there is no clear fastest provider.':'A comparable delivery estimate is missing.')}:null,
      evidencePolicy:'Agent-reported observations checked for exact basket, branch, address, delivery option, tip, currency, total consistency and freshness. Source authenticity is not independently verified.',
      displayInstructions:'Show BOTH providers with final total, fee/discount breakdown, applied benefits, delivery window and capture time. Explain price/time tradeoffs, exclusions and overlapping windows. Unknown fees stay unknown. A single quote is an available option, not a cross-provider winner. Never imply an order was placed.'};
  }
}
