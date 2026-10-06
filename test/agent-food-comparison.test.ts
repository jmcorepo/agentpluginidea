import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentFoodComparisons} from '../src/agent-food-comparison.js';
import {AgentComparisons} from '../src/agent-comparison.js';
import {createSwitchboardMcp} from '../src/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

export const foodInput={address:'1 Main St, Boston, MA 02110',restaurant:'Test Kitchen',restaurantAddress:'2 Elm St, Boston, MA 02111',items:[{name:'Rice bowl',quantity:1,notes:'Sauce on the side',modifiers:[{group:'Protein',option:'Chicken'}]}],tipCents:300,priority:'cheapest'};
const now=Date.parse('2026-10-06T12:00:00Z');
export function foodObservation(provider:'ubereats'|'doordash',overrides={}) {
  const ue=provider==='ubereats';
  return {provider,status:'observed',source:'provider_page',sourceUrl:ue?'https://www.ubereats.com/store/test-kitchen':'https://www.doordash.com/store/test-kitchen',capturedAt:new Date(now).toISOString(),address:foodInput.address,restaurant:foodInput.restaurant,restaurantAddress:foodInput.restaurantAddress,items:foodInput.items,tipCents:300,deliverySpeed:'standard',currencyContext:{kind:'explicit_currency',evidence:'Checkout currency: USD'},totalCents:ue?2300:2600,totalIncludesTip:true,totalEvidence:ue?'Total including tip $23.00 USD':'Total including tip $26.00 USD',breakdown:{subtotalCents:1500,taxCents:100,deliveryFeeCents:ue?200:500,serviceFeeCents:200,otherFeesCents:0,discountCents:0},etaMinutesMin:ue?35:20,etaMinutesMax:ue?45:30,etaEvidence:ue?'35–45 minutes':'20–30 minutes',benefits:[],evidence:'Synthetic test fixture: branch, items, delivery, tip, fees and total displayed.',...overrides};
}
function compare(changes={},other={},request={}) {
  const c=new AgentFoodComparisons(()=>now),p=c.prepare({...foodInput,...request});
  return c.finish({comparisonId:p.comparisonId,observations:[foodObservation('ubereats',changes),foodObservation('doordash',other)]});
}
test('food compares total with common tip and separates price from delivery tradeoff',()=>{
  const r=compare();assert.equal(r.status,'comparable');
  assert.deepEqual(r.ranking,{cheapest:'ubereats',fastest:'doordash'});
  assert.equal(r.priceDifferenceCents,300);assert.equal(r.recommendation?.provider,'ubereats');
  assert.equal(compare({}, {}, {priority:'quickest'}).recommendation?.provider,'doordash');
  assert.equal(r.quotes.length,2);assert.match(r.evidencePolicy,/not independently verified/);
});
test('different branches, items, selections, notes, tips and delivery addresses cannot be compared',()=>{
  const bad=[{restaurantAddress:'3 Other St, Boston, MA 02111'},{restaurant:'Other Kitchen'},{address:'3 Other St, Boston, MA 02110'},{tipCents:0},{items:[{...foodInput.items[0],quantity:2}]},{items:[{...foodInput.items[0],notes:''}]},{items:[{...foodInput.items[0],modifiers:[]}]}];
  for(const change of bad) {const r=compare(change);assert.equal(r.status,'incomplete');assert.equal(r.ranking.cheapest,null);assert.equal(r.recommendation,null);}
  assert.throws(()=>compare({deliverySpeed:'express'}));
});
test('food accepts formatting changes but preserves exact basket contents',()=>{
  assert.equal(compare({address:'1 Main Street, Boston, MA 02110, United States',restaurant:'TEST KITCHEN',items:[{name:'Rice Bowl',quantity:1,notes:'Sauce on the side.',modifiers:[{group:'protein',option:'chicken'}]}]}).status,'comparable');
  assert.equal(compare({address:'1 Main St, Boston, MA',restaurantAddress:'2 Elm St, Boston, MA'}).status,'comparable');
  assert.equal(compare({address:'1 Main St, Boston, MA 02111'}).status,'incomplete');
  assert.equal(compare({}, {}, {address:'1 Main St, Apt 2, Boston, MA 02110'}).status,'incomplete');
});
test('currency requires observed evidence, supports actual U.S. checkout context without ZIP',()=>{
  assert.equal(compare({currencyContext:{kind:'explicit_currency',evidence:'$23.00'}}).status,'incomplete');
  assert.equal(compare({currencyContext:{kind:'us_addresses'}}).status,'comparable');
  const request={address:'1 Main St, Boston, MA',restaurantAddress:'2 Elm St, Boston, MA'};
  const ctx={kind:'us_checkout',countryCode:'US',countryEvidence:'Country: United States',priceEvidence:'Total $23.00'};
  assert.equal(compare({...request,currencyContext:ctx},{...request,currencyContext:{...ctx,priceEvidence:'Total $26.00'}},request).status,'comparable');
  assert.equal(compare({...request,currencyContext:{kind:'us_addresses'}},{...request},request).status,'incomplete');
  assert.equal(compare({currencyContext:{...ctx,countryEvidence:'Requested address is Boston'}}).status,'incomplete');
  assert.equal(compare({totalEvidence:'Total $23.00 CAD'}).status,'incomplete');
  assert.equal(compare({currencyContext:{kind:'explicit_currency',evidence:'USD and CAD'}}).status,'incomplete');
});
test('checkout evidence rejects subtotals, wrong amounts, omitted tips and conflicting fee arithmetic',()=>{
  for(const change of [{totalEvidence:'Subtotal $23.00 USD'},{totalEvidence:'Subtotal $23.00 USD\nTotal $26.00 USD'},{totalEvidence:'Total $22.00 USD'},{totalIncludesTip:false},{breakdown:{...foodObservation('ubereats').breakdown,serviceFeeCents:201}}]) assert.equal(compare(change).status,'incomplete');
  const r=compare({breakdown:{subtotalCents:1500,taxCents:null,deliveryFeeCents:null,serviceFeeCents:null,otherFeesCents:null,discountCents:null}});
  assert.equal(r.status,'comparable');assert.equal(r.quotes[0]?.breakdown.taxCents,null);
  // Applied membership discount is counted once and shown, rather than inferred.
  const b=foodObservation('ubereats').breakdown;
  assert.equal(compare({totalCents:2200,totalEvidence:'Total $22.00 USD',breakdown:{...b,discountCents:100},benefits:['Applied $1 membership discount']}).status,'comparable');
});
test('overlapping or missing delivery windows and tied prices produce no false fastest claim',()=>{
  const overlap=compare({etaMinutesMin:25,etaMinutesMax:40});assert.equal(overlap.ranking.fastest,null);assert.equal(overlap.deliveryEstimatesOverlap,true);
  const unknown=compare({etaMinutesMin:null,etaMinutesMax:null,etaEvidence:''},{},{priority:'quickest'});assert.equal(unknown.recommendation?.provider,null);
  assert.equal(compare({etaMinutesMin:45,etaMinutesMax:35}).status,'incomplete');
  assert.equal(compare({etaEvidence:''}).status,'incomplete');
  const tie=compare({totalCents:2600,totalEvidence:'Total $26.00 USD',breakdown:{...foodObservation('ubereats').breakdown,deliveryFeeCents:500}});
  assert.equal(tie.ranking.cheapest,null);assert.equal(tie.ties.price,true);assert.equal(tie.priceDifferenceCents,0);
});
test('blocked or omitted provider is reported with no cross-provider winner',()=>{
  const c=new AgentFoodComparisons(()=>now),p=c.prepare(foodInput);
  const r=c.finish({comparisonId:p.comparisonId,observations:[foodObservation('ubereats'),{provider:'doordash',status:'unavailable',reason:'Provider login required'}]});
  assert.equal(r.status,'incomplete');assert.equal(r.quotes.length,1);assert.equal(r.ranking.cheapest,null);assert.match(r.excluded[0]!.reason,/login/);
  assert.equal(c.finish({comparisonId:p.comparisonId,observations:[foodObservation('ubereats')]}).excluded[0]?.provider,'doordash');
});
test('food rejects stale quotes, non-provider sources and leaked query strings',()=>{
  for(const change of [{capturedAt:new Date(now-1).toISOString()},{capturedAt:new Date(now+16000).toISOString()},{sourceUrl:'https://doordash.com.evil.test/store'},{sourceUrl:'https://www.ubereats.com/store?token=secret'},{sourceUrl:'https://auth.ubereats.com/'}]) assert.equal(compare(change).status,'incomplete');
});
test('food encrypted plans expire, reject tampering, duplicates, restarts and ride tokens',()=>{
  let time=now;const c=new AgentFoodComparisons(()=>time),p=c.prepare(foodInput);
  const observations=[foodObservation('ubereats')];
  assert.throws(()=>c.finish({comparisonId:p.comparisonId,observations:[...observations,...observations]}),/Duplicate/);
  assert.throws(()=>c.finish({comparisonId:p.comparisonId.slice(0,-10)+'AAAAAAAAAA',observations}),/unknown/);
  assert.throws(()=>new AgentFoodComparisons(()=>now).finish({comparisonId:p.comparisonId,observations}),/unknown/);
  const ride=new AgentComparisons(()=>now).prepare({pickup:foodInput.address,destination:foodInput.restaurantAddress,providers:['uber','lyft']});
  assert.throws(()=>c.finish({comparisonId:ride.comparisonId,observations}),/unknown/);
  assert.ok(!Buffer.from(p.comparisonId,'base64url').toString().includes(foodInput.address));
  time+=900000;assert.throws(()=>c.finish({comparisonId:p.comparisonId,observations}),/expired/);
});
test('MCP client can prepare and finish two observed food checkouts through the published schemas',async()=>{
  const server=createSwitchboardMcp(new AgentComparisons(()=>now),new AgentFoodComparisons(()=>now));
  const client=new Client({name:'food-schema-test',version:'1'}),[ct,st]=InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(st),client.connect(ct)]);
    const p=await client.callTool({name:'prepare_food_comparison',arguments:foodInput});assert.ok(!p.isError);
    const r=await client.callTool({name:'finish_food_comparison',arguments:{comparisonId:p.structuredContent!.comparisonId,observations:[foodObservation('ubereats'),foodObservation('doordash')]}});
    assert.ok(!r.isError);assert.equal(r.structuredContent!.status,'comparable');assert.deepEqual(r.structuredContent!.ranking,{cheapest:'ubereats',fastest:'doordash'});
  } finally {await client.close();await server.close();}
});
