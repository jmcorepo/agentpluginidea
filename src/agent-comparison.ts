import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {z} from 'zod';
import {verifyQuoteContext} from './verification.js';
import type {Quote, RideRequest} from './domain.js';

const address = z.string().trim().min(8).max(300);
const provider = z.enum(['uber','lyft']);
export const planSchema = z.object({
  pickup: address, destination: address,
  passengers: z.number().int().min(1).max(4).default(1),
  providers: z.array(provider).min(2).max(2).refine(p=>new Set(p).size===2,'Select Uber and Lyft once each'),
  priority: z.enum(['cheapest','quickest_arrival','quickest_pickup']).default('cheapest'),
}).strict();
const success = z.object({
  provider, status: z.literal('observed'),
  sourceUrl: z.string().url().max(1000), capturedAt: z.string().datetime(),
  pickup: address, destination: address,
  category: z.string().trim().min(1).max(50),
  capacity: z.number().int().min(1).max(8), shared: z.boolean(),
  currencyEvidence: z.enum(['USD','US$','observed-us-addresses']),
  totalCents: z.number().int().min(0).max(1000000),
  pickupMinutes: z.number().min(0).max(300).nullable(),
  tripMinutes: z.number().min(0).max(1440).nullable(),
  evidence: z.string().trim().min(10).max(6000),
  benefits: z.array(z.string().max(300)).max(10).default([]),
}).strict();
const failure = z.object({provider,status:z.literal('unavailable'),reason:z.string().trim().min(1).max(1000)}).strict();
export const finishSchema = z.object({comparisonId:z.string().min(40).max(5000),observations:z.array(z.discriminatedUnion('status',[success,failure])).min(1).max(2)}).strict();
type Observation = z.infer<typeof success>;

/** Client-held encrypted plans. No server-side trip, credential or history storage. */
export class AgentComparisons {
  private key=randomBytes(32);
  constructor(private now:()=>number = Date.now) {}
  prepare(input:unknown) {
    const request = planSchema.parse(input), now=this.now();
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify({request,createdAt:now}),'utf8'),cipher.final()]);
    const comparisonId=Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64url');
    return {
      comparisonId,request,expiresAt:new Date(now+300000).toISOString(),
      providers:[{provider:'uber',url:'https://m.uber.com/go/home',category:'UberX'},{provider:'lyft',url:'https://ride.lyft.com/',category:'Lyft / Standard'}],
      collect:['independently displayed pickup and destination','standard non-shared category and capacity','USD total after displayed benefits','pickup minutes','trip minutes if displayed','capture time','provider URL','visible page evidence'],
      instructions:'Use the host browser to check BOTH providers. Let the user sign in through the host secure login flow only when needed. Do not book rides. Submit observations to finish_ride_comparison; report blocked providers explicitly. Do not invent prices, benefits, timing, or connection status.',
      evidencePolicy:'Agent-reported browser observations; the server validates consistency, not authenticity of the source page.',
    };
  }
  finish(input:unknown) {
    const {comparisonId,observations}=finishSchema.parse(input), now=this.now();
    let plan:{request:z.infer<typeof planSchema>;createdAt:number};
    try {
      const token=Buffer.from(comparisonId,'base64url');
      if(token.toString('base64url')!==comparisonId) throw new Error('Invalid encoding');
      const decipher=createDecipheriv('aes-256-gcm',this.key,token.subarray(0,12));
      decipher.setAuthTag(token.subarray(12,28));
      plan=z.object({request:planSchema,createdAt:z.number().finite()}).parse(JSON.parse(Buffer.concat([decipher.update(token.subarray(28)),decipher.final()]).toString('utf8')));
    } catch {throw new Error('Comparison expired or unknown. Prepare a fresh comparison.');}
    if(now-plan.createdAt>=300000 || plan.createdAt>now) throw new Error('Comparison expired or unknown. Prepare a fresh comparison.');
    if(new Set(observations.map(o=>o.provider)).size!==observations.length) throw new Error('Duplicate provider observations are not allowed.');
    const accepted:Observation[]=[], excluded:{provider:string;reason:string}[]=[];
    for(const o of observations) {
      if(o.status==='unavailable') {excluded.push({provider:o.provider,reason:o.reason});continue;}
      const url=new URL(o.sourceUrl), host=url.hostname;
      const allowed=o.provider==='uber' ? host==='uber.com'||host.endsWith('.uber.com') : host==='lyft.com'||host.endsWith('.lyft.com');
      const captured=Date.parse(o.capturedAt);
      let reason:string|null=null;
      if(!allowed || url.protocol!=='https:' || url.username || url.password || url.search || url.hash) reason='Expected a clean HTTPS provider page URL without credentials or query parameters.';
      else if(captured<plan.createdAt || captured>now+15000 || now-captured>=300000) reason='Observation is stale, from before this request, or in the future.';
      else {
        const q={provider:o.provider,sector:'rides',observedContext:{kind:'rides',source:'provider_dom',pickup:o.pickup,destination:o.destination,serviceClass:'standard',category:o.category,capacity:o.capacity,shared:o.shared,evidence:o.evidence,currencyEvidence:o.currencyEvidence}} as Quote;
        reason=verifyQuoteContext(q,plan.request as RideRequest);
      }
      if(reason) excluded.push({provider:o.provider,reason}); else accepted.push(o);
    }
    for(const p of plan.request.providers) if(!observations.some(o=>o.provider===p)) excluded.push({provider:p,reason:'No observation supplied.'});
    const comparable=accepted.length===2;
    const winner=(score:(o:Observation)=>number)=>{
      const sorted=[...accepted].sort((a,b)=>score(a)-score(b));
      return score(sorted[0]!)===score(sorted[1]!)?null:sorted[0]!.provider;
    };
    const cheapest=comparable ? winner(o=>o.totalCents) : null;
    const pickupComparable=comparable && accepted.every(o=>o.pickupMinutes!==null);
    const arrivalComparable=pickupComparable && accepted.every(o=>o.tripMinutes!==null);
    const quickestPickup=pickupComparable ? winner(o=>o.pickupMinutes!) : null;
    const quickestArrival=arrivalComparable ? winner(o=>o.pickupMinutes!+o.tripMinutes!) : null;
    return {comparisonId,status:comparable?'comparable':'incomplete',request:plan.request,
      quotes:accepted.map(o=>({...o,arrivalMinutes:o.pickupMinutes!==null&&o.tripMinutes!==null?o.pickupMinutes+o.tripMinutes:null})),excluded,
      ranking:{cheapest,quickestPickup,quickestArrival},
      ties:{price:comparable && cheapest===null,pickup:pickupComparable && quickestPickup===null,arrival:arrivalComparable && quickestArrival===null},
      evidencePolicy:'Agent-reported observations checked for route, category, currency and freshness. Source authenticity is not independently verified.',
      displayInstructions:'Show provider, USD price, pickup wait and total arrival time separately. Cite provider pages and capture times. Explain exclusions. Do not declare a winner without comparable data; identify ties. Never imply a ride was booked.'};
  }
}
