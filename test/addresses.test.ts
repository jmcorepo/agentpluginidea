import assert from 'node:assert/strict';
import test from 'node:test';
import {createAddressSearch,normalizeAddressResults} from '../shared/addresses.mjs';
const feature=(properties:Record<string,unknown>,coordinates=[-87.62,41.88])=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{countrycode:'US',osm_type:'N',osm_id:1,...properties}});
const house={housenumber:'123',street:'Main Street',city:'Chicago',state:'Illinois',postcode:'60601'};
test('U.S. suggestions preserve provider address fields, normalize state, deduplicate and reject foreign/invalid locations',()=>{
 const data={features:[feature(house),feature(house),feature({...house,countrycode:'CA'}),feature(house,[999,999]),feature({street:'Oak Road',city:'Chicago',state:'Illinois'}),feature({name:'Airport',city:'Boston',state:'Massachusetts',postcode:'02128'})]};
 const list=normalizeAddressResults(data);assert.equal(list.length,3);assert.equal(list[0]!.label,'123 Main Street, Chicago, IL 60601');assert.equal(list[1]!.label,'Oak Road, Chicago, IL');assert.equal(list[2]!.label,'Airport, Boston, MA 02128');assert.equal(list[0]!.longitude,-87.62);
 assert.throws(()=>normalizeAddressResults({error:'unsupported'}),/unsupported/);
});
test('lookup uses documented country/language limits, skips short fragments and coalesces in-flight duplicate searches',async()=>{
 let calls=0;const search=createAddressSearch(async(url,init)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://photon.komoot.io');assert.equal(u.searchParams.get('countrycode'),'US');assert.equal(u.searchParams.get('lang'),'en');assert.equal(u.searchParams.get('q'),'123 Main');assert.ok(init.signal);await new Promise(resolve=>setTimeout(resolve,5));return{ok:true,json:async()=>({features:[feature(house)]})};});
 assert.equal((await search('12')).suggestions.length,0);assert.equal(calls,0);
 const [first,second]=await Promise.all([search('123 Main'),search('123 Main')]);assert.deepEqual(first,second);assert.equal(calls,1);await search('123 Main');assert.equal(calls,2,'Fragments are not cached after the request.');
});
test('address lookup failures remain explicit and malformed/oversized queries never cause upstream calls',async()=>{
 const failed=createAddressSearch(async()=>({ok:false,json:async()=>({})}));await assert.rejects(()=>failed('123 Main'),/unavailable/);await assert.rejects(()=>failed('a'.repeat(201)),/200/);
 const network=createAddressSearch(async()=>{throw new Error('private upstream details');});await assert.rejects(()=>network('123 Main'),error=>error instanceof Error&&/unavailable/.test(error.message)&&!error.message.includes('private'));
});
