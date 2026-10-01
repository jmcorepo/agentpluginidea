/** Local synthetic-fixture verification. Never contacts provider sites or seeds the app's normal data. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {chromium, type Browser, type Page} from 'playwright';
import {BrowserPool, providerHome} from '../src/browser.js';
import {Vault} from '../src/vault.js';
import {captureRides} from '../src/providers/rides.js';
import {captureEats} from '../src/providers/eats.js';
import {fingerprint, quoteExpiry} from '../src/comparison.js';
import {providers, type Comparison, type Quote} from '../src/domain.js';

const dataDir = await mkdtemp(join(tmpdir(),'switchboard-e2e-'));
const vault = new Vault(dataDir); await vault.init();
const rideRequest={pickup:'Synthetic origin',destination:'Synthetic destination',passengers:2};
const foodRequest={address:'Synthetic address',restaurant:'Fixture restaurant',tipCents:300,items:[{name:'Burger',quantity:1,notes:'No onions'}]};
const rideFingerprint=fingerprint('rides',rideRequest);
const provisional: Quote={id:crypto.randomUUID(),provider:'uber',sector:'rides',status:'needs_confirmation',source:'browser',label:'Synthetic standard',totalCents:2300,currency:'USD',capturedAt:new Date().toISOString(),expiresAt:quoteExpiry('rides'),etaMinutes:25,benefits:[],warnings:['Synthetic fixture, not a live quote.'],evidence:'Fixture USD $23.00',requestFingerprint:rideFingerprint};
const seeded: Comparison={id:crypto.randomUUID(),sector:'rides',fingerprint:rideFingerprint,request:rideRequest,createdAt:new Date().toISOString(),quotes:[provisional],warnings:['Synthetic test only'],ranking:{cheapest:null,fastest:null,eligibleCount:0,excludedCount:1}};
await vault.write('comparisons',[seeded]);
const browserPath=process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform==='linux'&&existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
let browser: Browser|undefined;
let server: ChildProcess|undefined;
let pool: BrowserPool|undefined;
let port=0;
let serverOutput='';
async function stopServer(){if(server&&!server.killed){const closed=once(server,'exit');server.kill('SIGTERM');await closed;}server=undefined;}
async function startServer(){
  const {createServer}=await import('node:net');const temporary=createServer();temporary.listen(0,'127.0.0.1');await once(temporary,'listening');const address=temporary.address();assert.ok(address&&typeof address==='object');port=address.port;await new Promise<void>(resolve=>temporary.close(()=>resolve()));
  server=spawn(process.execPath,['--import','tsx','src/server.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dataDir,BROWSER_HEADLESS:'true',MVP_PASSWORD:'synthetic-test-password'},stdio:['ignore','pipe','pipe']});
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timed out: '+serverOutput)),15000);server!.stdout!.on('data',chunk=>{serverOutput+=chunk.toString();if(serverOutput.includes('Dashboard ready:')){clearTimeout(timeout);resolve();}});server!.stderr!.on('data',chunk=>serverOutput+=chunk.toString());server!.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited: '+code+' '+serverOutput));});});
}
const base=()=>`http://127.0.0.1:${port}`;
async function api(page:Page,path:string,method='GET',body?:unknown){return page.evaluate(async({path,method,body})=>{const response=await fetch(path,{method,headers:{'X-MVP-Client':'dashboard','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};},{path,method,body});}
async function until(check:()=>Promise<boolean>,message:string){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error(message);}
try{
  browser=await chromium.launch({headless:true,executablePath:browserPath});
  // A fixture factory intercepts in-memory provider pages. No live network requests.
  pool=new BrowserPool(vault,async()=>{
    const fixtureBrowser=await chromium.launch({headless:true,executablePath:browserPath});
    const original=fixtureBrowser.newContext.bind(fixtureBrowser);
    fixtureBrowser.newContext=async options=>{const context=await original(options);context.on('page',page=>{void page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><label>Fixture field<input id="field"></label><button>Place order</button></body></html>'}));});return context;};
    return fixtureBrowser;
  });
  for(const provider of providers){
    const opened=await pool.open(provider);assert.equal(opened.status,'browser_open');
    await pool.withPage(provider,async page=>{
      await page.context().addCookies([{name:'fixture-session',value:provider,domain:new URL(providerHome[provider]).hostname,path:'/'}]);
      await page.goto(providerHome[provider]+'fixture-checkout');
      if(provider==='uber'||provider==='lyft'){
        await page.setContent(`<div>USD</div><div>${provider==='uber'?'UberX':'Standard'}</div><div>$23.00</div><div>Total trip time: 25 minutes</div>`);
        const result=await captureRides(provider,{page,fingerprint:rideFingerprint,expectedCurrency:'USD'},rideRequest);
        assert.equal(result.quotes[0]?.totalCents,2300);assert.equal(result.quotes[0]?.etaMinutes,25);assert.equal(result.quotes[0]?.status,'needs_confirmation');
      }else{
        await page.setContent('<h1>Checkout</h1><div>USD</div><div>Tip $3.00</div><div>Total $22.00</div><div>Delivery in 35 minutes</div>');
        const result=await captureEats(provider,{page,fingerprint:fingerprint('eats',foodRequest),expectedCurrency:'USD'},foodRequest);
        assert.equal(result.quotes[0]?.totalCents,2200);assert.equal(result.quotes[0]?.etaMinutes,35);assert.equal(result.quotes[0]?.status,'needs_confirmation');
        await page.setContent('<h1>Checkout</h1><div>USD</div><div>Subtotal $22.00</div>');
        assert.equal((await captureEats(provider,{page,fingerprint:'missing',expectedCurrency:'USD'},foodRequest)).quotes[0]?.totalCents,null);
      }
    });
    const reopened=await pool.open(provider);assert.ok(reopened.url?.endsWith('/fixture-checkout'),'Reopen must preserve prepared page');
    assert.ok((await pool.screenshot(provider)).length>1000);
    const persisted=await vault.read<any>(`session-${provider}`);assert.equal(persisted.cookies.find((c:any)=>c.name==='fixture-session')?.value,provider,'Provider cookies isolated');
  }
  await pool.withPage('uber',async page=>{await page.setContent('<input id="field"><button id="buy">Place order</button>');await page.locator('#field').focus();});
  await pool.action('uber',{type:'type',text:'typed fixture'});
  await pool.withPage('uber',async page=>{assert.equal(await page.locator('#field').inputValue(),'typed fixture');});
  await assert.rejects(()=>pool!.action('uber',{type:'navigate',url:'http://127.0.0.1'}),/HTTPS/);
  // Purchase guard runs outside withPage to avoid the per-provider serialization lock.
  let buyPoint={x:0,y:0};await pool.withPage('uber',async page=>{const box=await page.locator('#buy').boundingBox();assert.ok(box);buyPoint={x:box.x+box.width/2,y:box.y+box.height/2};});
  await assert.rejects(()=>pool!.action('uber',{type:'click',...buyPoint}),/Purchasing is disabled/);
  await pool.disconnect('lyft');assert.equal(await vault.read('session-lyft'),null);
  await pool.close();pool=undefined;
  console.log('PASS: real Chromium capture for four providers, isolation, reopen, screenshot, typing, purchase guard, disconnect (synthetic fixtures).');

  serverOutput='';await startServer();
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base());await page.locator('#login-dialog[open]').waitFor();
  await page.locator('#login-form input').fill('synthetic-test-password');await page.locator('#login-form button').click();await page.locator('#login-dialog').waitFor({state:'hidden'});
  assert.equal((await fetch(base()+'/api/comparisons')).status,403);
  assert.equal((await fetch(base()+'/api/status',{headers:{'X-MVP-Client':'dashboard',Origin:'https://foreign.example'}})).status,403);
  const unauth=await fetch(base()+'/api/comparisons',{headers:{'X-MVP-Client':'dashboard'}});assert.equal(unauth.status,401);
  assert.equal((await api(page,'/api/rides/compare','POST',{...rideRequest,passengers:0})).status,400);
  assert.equal((await api(page,`/api/comparisons/${seeded.id}/quotes/${provisional.id}/confirm`,'POST',{})).status,400);
  await page.locator('[data-view="history"]').click();await page.locator(`[data-history="${seeded.id}"]`).click();
  const confirmation=page.locator(`[data-confirm="${provisional.id}"]`);assert.equal(await confirmation.isDisabled(),true);
  await page.locator(`[data-verify-check="${provisional.id}"]`).check();await confirmation.click();await until(async()=>await page.locator('#rides-results').innerText().then(t=>t.includes('You verified this quote')),'UI confirmation failed');
  assert.equal((await api(page,`/api/comparisons/${seeded.id}`)).body.ranking.eligibleCount,1);
  assert.equal(await page.locator('#rides-results .badge').count(),0,'No winner with only one provider');
  await page.locator('#rides-results .manual-panel summary').click();
  const manual=page.locator('#rides-results .manual-form');await manual.locator('[name=provider]').selectOption('lyft');await manual.locator('[name=label]').fill('Synthetic standard');await manual.locator('[name=total]').fill('21.75');await manual.locator('[name=eta]').fill('30');await manual.locator('[name=verified]').check();await manual.locator('button').click();
  await until(async()=>await page.locator('#rides-results').innerText().then(t=>t.includes('$21.75')),'Manual quote UI failed');
  const ranked=(await api(page,`/api/comparisons/${seeded.id}`)).body;assert.equal(ranked.ranking.cheapest.provider,'lyft');assert.equal(ranked.ranking.fastest.provider,'uber');assert.equal(ranked.quotes.at(-1).source,'manual');
  assert.equal((await api(page,`/api/comparisons/${seeded.id}/manual`,'POST',{provider:'doordash',label:'wrong sector',totalCents:1})).status,400);
  await page.locator('#rides-form [name=pickup]').fill('Disconnected test origin');await page.locator('#rides-form [name=destination]').fill('Disconnected test destination');await page.locator('#rides-form button[type=submit]').click();await until(async()=>await page.locator('#rides-results').innerText().then(t=>t.includes('Open this provider browser and sign in first')),'Disconnected errors not shown');
  assert.equal(await page.locator('#rides-results [data-confirm]').count(),0);
  await page.locator('[data-view="eats"]').click();await page.locator('#eats-form [name=address]').fill(foodRequest.address);await page.locator('#eats-form [name=restaurant]').fill(foodRequest.restaurant);await page.locator('.item-name').fill('Burger');await page.locator('#eats-form [name=tip]').fill('3.00');await page.locator('#eats-form button[type=submit]').click();await until(async()=>await page.locator('#eats-results .manual-form').count()===1,'Eats comparison not rendered');
  await page.locator('#eats-results .manual-panel summary').click();const eatsManual=page.locator('#eats-results .manual-form');await eatsManual.locator('[name=label]').fill('Synthetic basket');await eatsManual.locator('[name=total]').fill('22.00');await eatsManual.locator('[name=verified]').check();await eatsManual.locator('button').click();await until(async()=>await page.locator('#eats-results').innerText().then(t=>t.includes('$22.00')),'Eats manual quote failed');
  const beforeRestart=(await api(page,'/api/comparisons')).body.comparisons.length;assert.equal(beforeRestart,3);
  await page.reload();await page.locator('[data-view="history"]').click();await until(async()=>await page.locator('.history-row').count()===3,'History reload failed');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(tmpdir(),'switchboard-mobile-debug.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile layout overflows: '+JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>window.innerWidth).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})).slice(0,10))));
  await page.screenshot({path:join(tmpdir(),'switchboard-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const raw=await readFile(join(dataDir,'comparisons.enc'));assert.equal(raw.includes(Buffer.from('Synthetic origin')),false);
  await stopServer();serverOutput='';await startServer();await page.goto(base());await page.locator('#login-form input').fill('synthetic-test-password');await page.locator('#login-form button').click();await page.locator('#login-dialog').waitFor({state:'hidden'});
  assert.equal((await api(page,'/api/comparisons')).body.comparisons.length,beforeRestart);
  console.log('PASS: dashboard login, API guards, confirmation, two-provider rankings, rides/eats manual fallback, missing provider errors, encrypted history, reload/restart, mobile layout; no page errors.');
}finally{await pool?.close().catch(()=>{});await stopServer();await browser?.close();await rm(dataDir,{recursive:true,force:true});}
