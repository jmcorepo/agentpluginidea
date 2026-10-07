/** Proxy contract fixtures only. No real runtime, provider site or D1 writes. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile('dist/server/index.js','utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const origin='https://dashboard.test';
const config={RUNTIME_URL:'https://runtime.test/',RUNTIME_PASSWORD:'synthetic-private-password'};
let calls=[],loginCount=0,unauthorizedOnce=false,statusLockedOnce=false,loginFailure=false,networkFailure=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 const target=String(url),headers=new Headers(options.headers);
 if(target.startsWith('https://photon.komoot.io/api/')){
  assert.equal(headers.get('Cookie'),null);assert.equal(headers.get('Authorization'),null);
  const u=new URL(target);assert.equal(u.searchParams.get('countrycode'),'US');
  return new Response(JSON.stringify({features:[{type:'Feature',geometry:{type:'Point',coordinates:[-77.03,38.90]},properties:{countrycode:'US',osm_type:'N',osm_id:1,housenumber:'1600',street:'Pennsylvania Avenue Northwest',city:'Washington',state:'District of Columbia',postcode:'20500'}}]}),{headers:{'Content-Type':'application/json'}});
 }
 calls.push({target,method:options.method,headers,body:options.body});
 assert.equal(headers.get('Origin'),'https://runtime.test');assert.equal(headers.get('X-MVP-Client'),'dashboard');
 assert.equal(options.redirect,'manual');assert.equal(headers.get('Authorization'),null);assert.equal(headers.get('OAI-Sites-Authorization'),null);
 if(networkFailure)throw new Error('Do not expose synthetic-private-password or private-cookie');
 if(target.endsWith('/api/login')){
  loginCount++;assert.deepEqual(JSON.parse(options.body),{password:config.RUNTIME_PASSWORD});assert.equal(headers.get('Cookie'),null);
  if(loginFailure)return new Response('private authentication error',{status:401});
  await new Promise(resolve=>setTimeout(resolve,5));
  return new Response('{"ok":true}',{headers:{'Set-Cookie':`mvp_session=private-cookie-${loginCount}; HttpOnly; Max-Age=43200`,'Content-Type':'application/json'}});
 }
 assert.match(headers.get('Cookie'),/^mvp_session=private-cookie-\d+$/);
 if(unauthorizedOnce){unauthorizedOnce=false;return new Response('{"error":"expired"}',{status:401,headers:{'Content-Type':'application/json'}});}
 if(target.endsWith('/api/status')){if(statusLockedOnce){statusLockedOnce=false;return new Response('{"authRequired":true}',{headers:{'Content-Type':'application/json'}});}return new Response('{"authRequired":false,"mode":"automatic-browser","browserAvailable":true,"connections":[]}',{headers:{'Content-Type':'application/json','Set-Cookie':'must-not-reach-client'}});}
 if(target.includes('/screenshot'))return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png','Set-Cookie':'must-not-reach-client'}});
 if(target.endsWith('/api/rides/compare'))return new Response(JSON.stringify({id:'job-1',sector:'rides',status:'running',providers:{uber:{status:'preparing'}}}),{status:202,headers:{'Content-Type':'application/json','Set-Cookie':'must-not-reach-client'}});
 return new Response('{"ok":true}',{headers:{'Content-Type':'application/json','Set-Cookie':'must-not-reach-client'}});
};
function call(path,method='GET',body,env=config,extraHeaders={}){return worker.fetch(new Request(origin+path,{method,headers:{'Content-Type':'application/json','X-MVP-Client':'dashboard',Origin:origin,...extraHeaders},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);}
try{
 let response=await call('/api/status','GET',undefined,{});const disconnected=await response.json();assert.equal(disconnected.mode,'cloud-runtime-disconnected');assert.equal(disconnected.runtimeConnected,false);assert.equal(disconnected.browserAvailable,false);assert.equal(disconnected.authRequired,false);assert.deepEqual(disconnected.connections,[]);assert.equal(calls.length,0);
 for(const path of ['/api/rides/compare','/api/eats/compare','/api/comparisons/example/manual'])assert.equal((await call(path,'POST',{},{})).status,503);
 assert.equal((await call('/api/status','GET',undefined,config,{Origin:'https://foreign.test'})).status,403);
 assert.equal((await call('/api/status','GET',undefined,config,{'X-MVP-Client':'foreign'})).status,403);
 assert.equal((await call('/api/status','GET',undefined,config,{'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal(calls.length,0);
 response=await call('/api/addresses/search?q=1600%20Pennsylvania','GET',undefined,{});assert.equal(response.status,200);const addresses=await response.json();assert.equal(addresses.suggestions[0].label,'1600 Pennsylvania Avenue Northwest, Washington, DC 20500');assert.equal(loginCount,0,'Address lookup works without browser runtime or login');
 assert.equal((await call('/api/addresses/search?q=aa','GET',undefined,{})).status,200);
 const statuses=await Promise.all([call('/api/status'),call('/api/status')]);assert.equal(loginCount,1,'Concurrent requests share one private login');
 for(const r of statuses){assert.equal(r.headers.get('Set-Cookie'),null);const s=await r.json();assert.equal(s.runtimeConnected,true);assert.equal(s.authRequired,false);assert.equal(s.mode,'automatic-browser');}
 const rideRequest={pickup:'Fixture origin',destination:'Fixture destination',passengers:2,serviceClass:'standard'};
 response=await call('/api/rides/compare','POST',rideRequest,config,{Cookie:'client-secret',Authorization:'Bearer client-secret','OAI-Sites-Authorization':'Bearer client-service-secret'});assert.equal(response.status,202);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal((await response.json()).id,'job-1');assert.equal(loginCount,1);assert.deepEqual(JSON.parse(calls.at(-1).body),rideRequest);
 response=await call('/api/browser/uber/screenshot?t=123');assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.headers.get('Set-Cookie'),null);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[137,80,78,71]);assert.equal(calls.at(-1).target,'https://runtime.test/api/browser/uber/screenshot?t=123');
 await call('/api/jobs/job-1');await call('/api/connections/lyft/open','POST',{});await call('/api/browser/lyft/action','POST',{type:'key',key:'Tab'});await call('/api/connections/lyft','DELETE');
 assert.equal((await call('/api/comparisons/example/manual','POST',{})).status,404);assert.equal((await call('/api/login','POST',{password:'client-password'})).status,404);
 unauthorizedOnce=true;response=await call('/api/jobs/job-1');assert.equal(response.status,200);assert.equal(loginCount,2,'Expired session retries through private login');
 statusLockedOnce=true;response=await call('/api/status');assert.equal((await response.json()).runtimeConnected,true);assert.equal(loginCount,3,'A runtime restart returning locked HTTP200 refreshes private login');
 loginFailure=true;unauthorizedOnce=true;response=await call('/api/jobs/job-1');assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private-cookie|synthetic-private-password/);loginFailure=false;
 networkFailure=true;response=await call('/api/status');assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private-cookie|synthetic-private-password/);networkFailure=false;
 const before=calls.length;for(const env of [{...config,RUNTIME_URL:'http://runtime.test'},{...config,RUNTIME_URL:origin},{...config,RUNTIME_URL:'https://runtime.test/subpath'},{...config,RUNTIME_PASSWORD:'short'}])assert.equal((await call('/api/status','GET',undefined,env)).status,503);assert.equal(calls.length,before);
 response=await worker.fetch(new Request(origin+'/'),{});assert.equal(response.status,200);const html=await response.text();assert.match(html,/restaurantAddress/);assert.doesNotMatch(html,/manual-form|manual-panel/);
 response=await worker.fetch(new Request(origin+'/app.js'),{});assert.equal(response.status,200);assert.match(await response.text(),/cloud-runtime-disconnected/);
 console.log('Cloud contracts passed: standalone real-service address lookup handler (fixture response), disconnected state, same-origin guards, cached private authentication, job/body/query/binary relay, cookie stripping, auth recovery and fail-closed errors. No live requests or D1 writes.');
}finally{globalThis.fetch=originalFetch;}
