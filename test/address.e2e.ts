/** Isolated HTTP/browser fixtures; no server or public address service is contacted. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const files=Object.fromEntries(await Promise.all(['index.html','app.js','style.css','favicon.svg','address-autocomplete.js'].map(async name=>[name,await readFile(new URL('../public/'+name,import.meta.url),'utf8')])));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)});
const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}});
const page=await context.newPage();const queries:string[]=[],finished:string[]=[],errors:string[]=[];
const labels=(query:string)=>[`${query} Fixture Street, Test City, NY 10001`,`${query} Fixture Avenue, Test City, NY 10002`];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{
  const runtime=window as typeof window & {fixtureIgnoreAbort:boolean;fixtureSubmits:number};runtime.fixtureIgnoreAbort=false;runtime.fixtureSubmits=0;
  const original=window.fetch.bind(window);
  window.fetch=(input,options)=>{if(runtime.fixtureIgnoreAbort&&String(input).startsWith('/api/addresses/search')){const safe={...options};delete safe.signal;return original(input,safe);}return original(input,options);};
  document.addEventListener('submit',()=>runtime.fixtureSubmits++,true);
});
await page.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,'https://address-fixture.test','All documents and lookups stay inside the isolated fixture origin');
  if(url.pathname==='/api/status')return route.fulfill({json:{authRequired:false,browserAvailable:false,connections:[]}});
  if(url.pathname==='/api/addresses/search'){
    assert.equal(route.request().headers()['x-mvp-client'],'dashboard');const query=url.searchParams.get('q')!;queries.push(query);assert.ok(query.length>=3);
    if(query==='failure')return route.fulfill({status:503,json:{error:'Synthetic unavailable lookup'}});
    await new Promise(resolve=>setTimeout(resolve,query==='slow-old'?950:15));
    await route.fulfill({json:{suggestions:query==='empty'?[]:labels(query).map((label,index)=>({id:query+'-'+index,label,latitude:40+index/100,longitude:-73})),attribution:'© OpenStreetMap contributors; search by Photon'}}).catch(()=>{});finished.push(query);return;
  }
  if(url.pathname==='/api/comparisons')return route.fulfill({json:{comparisons:[]}});
  const name=url.pathname==='/'?'index.html':url.pathname.slice(1);assert.ok(Object.hasOwn(files,name),'Unexpected fixture request: '+url.pathname);
  return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html',body:files[name]});
});
try{
  await page.goto('https://address-fixture.test/');const pickup=page.locator('[name=pickup]');
  await pickup.fill('ab');await page.waitForTimeout(350);assert.equal(queries.length,0,'Short queries never make a lookup');assert.equal(await pickup.getAttribute('role'),'combobox');
  await pickup.fill('first');await page.waitForTimeout(100);await pickup.fill('final');await page.locator('#address-pickup-suggestions').waitFor({state:'visible'});assert.deepEqual(queries,['final'],'Debouncing searches only the newest query');
  await pickup.press('ArrowDown');await pickup.press('ArrowDown');assert.equal(await page.locator('[role=option][aria-selected=true]').innerText(),labels('final')[1]);assert.ok(await pickup.getAttribute('aria-activedescendant'));
  await pickup.press('Enter');assert.equal(await pickup.inputValue(),labels('final')[1]);assert.equal(await pickup.getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>(window as any).fixtureSubmits),0,'Selecting Enter never submits the comparison');
  const destination=page.locator('[name=destination]');await destination.fill('destination');await page.locator('#address-destination-suggestions').waitFor({state:'visible'});await page.locator('#address-destination-suggestions [role=option]').first().click();assert.equal(await destination.inputValue(),labels('destination')[0]);
  await page.locator('[data-view=eats]').click();const delivery=page.locator('[name=address]');await delivery.fill('delivery');await page.locator('#address-address-suggestions').waitFor({state:'visible'});await page.locator('#address-address-suggestions [role=option]').last().tap();assert.equal(await delivery.inputValue(),labels('delivery')[1],'Touch selects the complete delivery label');
  const branch=page.locator('[name=restaurantAddress]');await branch.fill('branch');await page.locator('#address-restaurantAddress-suggestions').waitFor({state:'visible'});await branch.press('ArrowUp');await branch.press('Enter');assert.equal(await branch.inputValue(),labels('branch')[1]);assert.equal(await page.locator('.address-attribution a:visible').last().getAttribute('href'),'https://www.openstreetmap.org/copyright');
  await branch.fill('escape');await page.locator('#address-restaurantAddress-suggestions').waitFor({state:'visible'});await branch.press('Escape');assert.equal(await branch.inputValue(),'escape');assert.equal(await branch.getAttribute('aria-expanded'),'false');
  await branch.fill('old-option');await page.locator('#address-restaurantAddress-suggestions').waitFor({state:'visible'});await page.evaluate(()=>(window as any).fixtureStaleOption=document.querySelector('#address-restaurantAddress-suggestions [role=option]'));await branch.fill('manual-new');await page.evaluate(()=>(window as any).fixtureStaleOption.click());assert.equal(await branch.inputValue(),'manual-new','A queued old option click cannot overwrite fresh typing');await branch.press('Escape');
  await page.evaluate(()=>(window as any).fixtureIgnoreAbort=true);await branch.fill('slow-old');await page.waitForFunction(()=>document.querySelector('#address-restaurantAddress-lookup-status')?.textContent==='Looking up addresses…');
  await branch.fill('fresh-new');await page.getByRole('option',{name:labels('fresh-new')[0],exact:true}).waitFor();while(!finished.includes('slow-old'))await page.waitForTimeout(20);assert.equal(await branch.inputValue(),'fresh-new');assert.equal(await page.locator('#address-restaurantAddress-suggestions [role=option]').first().innerText(),labels('fresh-new')[0],'Late response cannot replace fresh input or suggestions even if abort is ignored');
  await branch.fill('failure');await page.waitForFunction(()=>document.querySelector('#address-restaurantAddress-lookup-status')?.textContent?.includes('unavailable'));assert.equal(await branch.inputValue(),'failure');assert.equal(await branch.getAttribute('aria-expanded'),'false');
  await branch.fill('empty');await page.waitForFunction(()=>document.querySelector('#address-restaurantAddress-lookup-status')?.textContent?.startsWith('No matching'));assert.equal(await branch.inputValue(),'empty');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Autocomplete fits mobile viewport');assert.deepEqual(errors,[]);
  console.log('PASS address UI: four fields, min length/debounce, keyboard/Enter/Escape, pointer/touch, attribution, stale response rejection, manual fallback and mobile sizing; isolated fixtures only.');
}finally{await browser.close();}
