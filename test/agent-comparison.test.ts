import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentComparisons} from '../src/agent-comparison.js';
import {createSwitchboardMcp} from '../src/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {createServer,request} from 'node:http';
import type {AddressInfo} from 'node:net';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createMcpHandler} from '../src/mcp-handler.js';

const input={pickup:'1 Main St, Boston, MA 02110',destination:'2 Elm St, Boston, MA 02111',providers:['uber','lyft']};
const now=Date.parse('2026-10-06T12:00:00Z');
function observation(provider:'uber'|'lyft',overrides={}) {
  return {provider,status:'observed',sourceUrl:provider==='uber'?'https://m.uber.com/go/home':'https://ride.lyft.com/',capturedAt:new Date(now).toISOString(),pickup:input.pickup,destination:input.destination,category:provider==='uber'?'UberX':'Lyft',capacity:4,shared:false,currencyEvidence:'USD',totalCents:provider==='uber'?2000:2500,pickupMinutes:provider==='uber'?5:3,tripMinutes:provider==='uber'?10:20,evidence:'Provider displayed matching route, USD price and timings.',...overrides};
}
test('agent quotes rank price, pickup and arrival independently',()=>{
  const c=new AgentComparisons(()=>now),p=c.prepare(input);
  const r=c.finish({comparisonId:p.comparisonId,observations:[observation('uber'),observation('lyft')]});
  assert.deepEqual(r.ranking,{cheapest:'uber',quickestPickup:'lyft',quickestArrival:'uber'});
  assert.match(r.evidencePolicy,/not independently verified/);
});
test('mismatches, missing providers and unknown timing do not produce false winners',()=>{
  const c=new AgentComparisons(()=>now),p=c.prepare(input);
  const bad=[{destination:'3 Other St, Boston, MA 02111'},{shared:true},{category:'UberXL'},{sourceUrl:'https://uber.com.evil.test/'},{capturedAt:new Date(now-1).toISOString()}];
  for(const change of bad) {
    const r=c.finish({comparisonId:p.comparisonId,observations:[observation('uber',change),observation('lyft')]});assert.equal(r.ranking.cheapest,null);assert.equal(r.status,'incomplete');
  }
  for(const change of [{capacity:0},{currencyEvidence:'EUR'}]) assert.throws(()=>c.finish({comparisonId:p.comparisonId,observations:[observation('uber',change),observation('lyft')]}));
  assert.equal(c.finish({comparisonId:p.comparisonId,observations:[observation('uber')]}).ranking.cheapest,null);
  const unknown=c.finish({comparisonId:p.comparisonId,observations:[observation('uber',{tripMinutes:null}),observation('lyft')]});
  assert.equal(unknown.ranking.quickestArrival,null);assert.equal(unknown.ranking.quickestPickup,'lyft');
  const tied=c.finish({comparisonId:p.comparisonId,observations:[observation('uber',{totalCents:2500}),observation('lyft')]});
  assert.equal(tied.ranking.cheapest,null);assert.equal(tied.ties.price,true);
});
test('expired plans and duplicate observations are rejected',()=>{
  let time=now;const c=new AgentComparisons(()=>time),p=c.prepare(input);
  assert.throws(()=>c.finish({comparisonId:p.comparisonId,observations:[observation('uber'),observation('uber')]}),/Duplicate/);
  time+=300000;assert.throws(()=>c.finish({comparisonId:p.comparisonId,observations:[observation('uber')]}),/expired/);
});
test('encrypted plan cannot be altered or reused with a different process key',()=>{
  const c=new AgentComparisons(()=>now),p=c.prepare(input);
  assert.throws(()=>c.finish({comparisonId:p.comparisonId.slice(0,-10)+'AAAAAAAAAA',observations:[observation('uber')]}),/unknown/);
  assert.throws(()=>new AgentComparisons(()=>now).finish({comparisonId:p.comparisonId,observations:[observation('uber')]}),/unknown/);
  assert.ok(!Buffer.from(p.comparisonId,'base64url').toString().includes(input.pickup));
});
test('real MCP client discovers tools and completes a two-call comparison',async()=>{
  const server=createSwitchboardMcp(new AgentComparisons(()=>now));
  const client=new Client({name:'switchboard-test',version:'1.0.0'});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(st),client.connect(ct)]);
    const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name),['prepare_ride_comparison','finish_ride_comparison','prepare_food_comparison','finish_food_comparison','compare_food_quotes']);
    const manifest=await client.request({method:'skills/list',params:{}},z.object({skills:z.array(z.any())}));
    assert.equal(manifest.skills[0].frontmatter.name,'compare-rides');
    const resource=await client.readResource({uri:manifest.skills[0].uri});
    const text=(resource.contents[0] as {text:string}).text;
    assert.equal(manifest.skills[0].resources[0].digest,`sha256:${createHash('sha256').update(text).digest('hex')}`);
    assert.match(text,/finish_ride_comparison/);
    assert.equal(manifest.skills[1].frontmatter.name,'compare-food');
    const foodResource=await client.readResource({uri:manifest.skills[1].uri});
    const foodText=(foodResource.contents[0] as {text:string}).text;
    assert.equal(manifest.skills[1].resources[0].digest,`sha256:${createHash('sha256').update(foodText).digest('hex')}`);
    const fallback=manifest.skills[1].resources.find((resource:{uri:string})=>resource.uri.endsWith('/references/without-mcp.md'));
    assert.ok(fallback,'food skill imports must include the optional-MCP comparison reference');
    const fallbackResource=await client.readResource({uri:fallback.uri});
    const fallbackText=String(fallbackResource.contents[0]?.text);
    assert.equal(fallback.digest,`sha256:${createHash('sha256').update(fallbackText).digest('hex')}`);
    assert.match(fallbackText,/has not passed the Switchboard server validator/);
    const signIn=manifest.skills[1].resources.find((resource:{uri:string})=>resource.uri.endsWith('/references/sign-in.md'));
    assert.ok(signIn,'food skill imports must include the sign-in guide');
    const signInResource=await client.readResource({uri:signIn.uri});
    const signInText=String(signInResource.contents[0]?.text);
    assert.equal(signIn.digest,`sha256:${createHash('sha256').update(signInText).digest('hex')}`);
    assert.match(signInText,/Provider sign-in playbook/);
    assert.match(foodText,/finish_food_comparison/);
    const foodManifest=await client.request({method:'skills/get',params:{uri:manifest.skills[1].uri}},z.object({skill:z.any()}));
    assert.deepEqual(foodManifest.skill,manifest.skills[1]);
    const p=await client.callTool({name:'prepare_ride_comparison',arguments:input});assert.equal(p.isError,undefined);
    const comparisonId=p.structuredContent!.comparisonId;
    const r=await client.callTool({name:'finish_ride_comparison',arguments:{comparisonId,observations:[observation('uber'),observation('lyft')]}});
    assert.equal(r.isError,undefined);assert.equal(r.structuredContent!.status,'comparable');
    const invalid=await client.callTool({name:'finish_ride_comparison',arguments:{comparisonId:'not-an-id',observations:[]}});assert.equal(invalid.isError,true);
  } finally {await client.close();await server.close();}
});
test('hosted HTTP handler shares no browser access and completes stateless MCP calls',async()=>{
  let handler:ReturnType<typeof createMcpHandler>;
  const http=createServer((req,res)=>{void handler(req,res);});
  await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
  const port=(http.address() as AddressInfo).port;
  const origin=`http://127.0.0.1:${port}`;handler=createMcpHandler(origin);
  const client=new Client({name:'http-test',version:'1'});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{
      requestInit:{headers:{Origin:'https://chatgpt.com'}},
    }));
    const p=await client.callTool({name:'prepare_ride_comparison',arguments:input});
    assert.ok(!p.isError);
    const r=await client.callTool({name:'finish_ride_comparison',arguments:{comparisonId:p.structuredContent!.comparisonId,observations:[{provider:'uber',status:'unavailable',reason:'Fixture: blocked'},{provider:'lyft',status:'unavailable',reason:'Fixture: blocked'}]}});
    assert.equal(r.structuredContent!.status,'incomplete');
    const fp=await client.callTool({name:'prepare_food_comparison',arguments:{address:input.pickup,restaurant:'Test Kitchen',restaurantAddress:input.destination,items:[{name:'Rice bowl',quantity:1}],tipCents:300}});
    assert.ok(!fp.isError);
    const fr=await client.callTool({name:'finish_food_comparison',arguments:{comparisonId:fp.structuredContent!.comparisonId,observations:[{provider:'ubereats',status:'unavailable',reason:'Fixture: login required'},{provider:'doordash',status:'unavailable',reason:'Fixture: login required'}]}});
    assert.ok(!fr.isError);assert.equal(fr.structuredContent!.status,'incomplete');
    assert.equal((await fetch(origin+'/mcp',{method:'POST',headers:{Origin:'https://example.com'}})).status,403);
    assert.equal((await fetch(origin+'/mcp',{method:'POST',headers:{Origin:'https://chatgpt.com.evil.test'}})).status,403);
    const badHost=await new Promise<number|undefined>((resolve,reject)=>{
      const req=request(origin+'/mcp',{method:'POST',headers:{Host:'evil.test',Origin:'https://chatgpt.com'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
      req.on('error',reject);req.end();
    });
    assert.equal(badHost,403);
    assert.equal((await fetch(origin+'/mcp')).status,405);
  } finally {await client.close();await new Promise<void>((r,j)=>http.close(e=>e?j(e):r()));}
});
