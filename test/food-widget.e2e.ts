/** Synthetic MCP host bridge and provider data; no live sign-in or order. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {foodWidgetHtml} from '../src/food-widget.js';
import {AgentFoodComparisons} from '../src/agent-food-comparison.js';
import {foodInput,foodObservation} from './fixtures/agent-food.js';

const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[],network:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>network.push(r.url()));
  // Host emulator performs real initialization and delivers data only after
  // initialized. This verifies the standard iframe path, not just a global.
  const host=`<!doctype html><iframe title="comparison" style="border:0;width:100%;height:1300px"></iframe><script>
  window.calls=[];const f=document.querySelector('iframe');
  addEventListener('message',e=>{if(e.source!==f.contentWindow)return;window.calls.push(e.data.method);
    if(e.data.method==='ui/initialize')f.contentWindow.postMessage({jsonrpc:'2.0',id:e.data.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'Test host',version:'1'},hostCapabilities:{},hostContext:{theme:'light'}}},'*');
    if(e.data.method==='ui/notifications/initialized'){window.ready=true;if(window.result)f.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:window.result}},'*');}
  });</script>`;
  await page.setContent(host);
  await page.locator('iframe').evaluate((f,html)=>(f as HTMLIFrameElement).srcdoc=html,foodWidgetHtml);
  await page.waitForFunction(()=>Boolean((window as any).ready));
  const frame=page.frameLocator('iframe'),c=new AgentFoodComparisons(()=>Date.parse('2026-10-06T12:00:00Z'));
  const valid=c.compare({request:foodInput,observations:[foodObservation('ubereats'),foodObservation('doordash')]});
  const deliver=async(result:unknown)=>page.evaluate(r=>document.querySelector('iframe')!.contentWindow!.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:r}},'*'),result);
  const fresh=(r:typeof valid)=>({...r,checkedAt:new Date().toISOString(),quotes:r.quotes.map(q=>({...q,capturedAt:new Date().toISOString()}))});
  await deliver(fresh(valid));await frame.locator('#headline').filter({hasText:'Uber Eats saves $3.00'}).waitFor();
  assert.match(await frame.locator('#tradeoff').innerText(),/DoorDash has the earlier/);
  await frame.getByRole('button',{name:'Delivery time',exact:true}).click();assert.equal(await frame.locator('.card h2').first().innerText(),'DoorDash');
  await frame.locator('summary').first().click();assert.match(await frame.locator('dl').first().innerText(),/Tip\s+\$3.00/);
  assert.equal(await frame.locator('body').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  await page.screenshot({path:'/tmp/switchboard-food-card-mobile.png',fullPage:true});
  const overlap=c.compare({request:foodInput,observations:[foodObservation('ubereats',{etaMinutesMin:25,etaMinutesMax:40}),foodObservation('doordash')]});
  await deliver(fresh(overlap));await frame.locator('#tradeoff').filter({hasText:'no clear fastest'}).waitFor();assert.equal(await frame.locator('.badge').count(),0);
  const incomplete=c.compare({request:foodInput,observations:[foodObservation('ubereats'),{provider:'doordash',status:'unavailable',reason:'Login required <img src=x onerror=alert(1)>'}]});
  await deliver(fresh(incomplete));await frame.locator('#headline').filter({hasText:'Comparison incomplete'}).waitFor();assert.equal(await frame.locator('.badge').count(),0);assert.equal(await frame.locator('img').count(),0);
  assert.match(await frame.locator('.blocked').innerText(),/Login required/);
  await deliver(valid);await frame.locator('#stale').waitFor({state:'visible'});assert.equal(await frame.locator('.badge').count(),0);
  assert.equal((await page.evaluate(()=>(window as any).calls)).includes('tools/call'),false);
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  await page.setViewportSize({width:900,height:900});await deliver(fresh(valid));await frame.locator('#stale').waitFor({state:'hidden'});
  await page.screenshot({path:'/tmp/switchboard-food-card-desktop.png',fullPage:true});
  await writeFile('/tmp/switchboard-food-card-preview.html',foodWidgetHtml);
  console.log('PASS: MCP Apps handshake, 390px layout, sorting without tool calls, fees, honest rankings, blocked providers, stale quotes and safe text rendering. Synthetic host only.');
} finally {await browser.close();}
