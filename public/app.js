const names = {uber:'Uber',lyft:'Lyft',ubereats:'Uber Eats',doordash:'DoorDash'};
const marks = {uber:'U',lyft:'ly',ubereats:'UE',doordash:'D'};
const sectors = {rides:['uber','lyft'],eats:['doordash','ubereats']};
const state = {view:'rides',status:null,comparisons:{},provider:null,screenshot:null,browserBusy:false,expiryTimers:{},authLocked:false};
const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dollars = (cents) => Number.isInteger(cents) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100) : 'Unavailable';
const when = (date) => date ? new Date(date).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
function parseDollars(value) {
  if(!/^\d+(\.\d{1,2})?$/.test(String(value).trim())) throw new Error('Enter a valid USD amount, with at most two decimal places.');
  const [whole,fraction=''] = String(value).trim().split('.');
  const cents = Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents<0||cents>10000000) throw new Error('Amount is outside the supported range.');
  return cents;
}
function notice(message,success=false){$('notice').textContent=message;$('notice').classList.remove('hidden');$('notice').classList.toggle('success',success);}
function clearNotice(){$('notice').classList.add('hidden');}
async function api(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json','X-MVP-Client':'dashboard',...options.headers}});
  if(response.status===401){state.authLocked=true;if(!$('login-dialog').open)$('login-dialog').showModal();throw new Error('Sign in to your local workspace.');}
  const isJson=response.headers.get('content-type')?.includes('application/json');
  const data=isJson?await response.json():await response.text();
  if(!response.ok)throw new Error(typeof data==='string'?data:(data.error?.message||data.error||data.message||`Request failed (${response.status})`));
  return data;
}
const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});
async function busy(button,work){const old=button.textContent;button.disabled=true;button.textContent='Working…';try{return await work();}catch(error){notice(error.message);if($('browser-dialog').open)$('browser-message').textContent=error.message;}finally{button.disabled=false;button.textContent=old;}}
function showView(view){if(!['rides','eats','connections','history','settings'].includes(view))view='rides';state.view=view;document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==`view-${view}`));document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));location.hash=view;clearNotice();if((view==='rides'||view==='eats')&&state.comparisons[view])refreshComparison(state.comparisons[view].id);if(view==='history')loadHistory();if(view==='connections'||view==='settings')refreshStatus();}
async function refreshStatus(){
  try{state.status=await api('/api/status');if(state.status.authRequired){state.authLocked=true;$('runtime-status').textContent='Workspace locked';if(!$('login-dialog').open)$('login-dialog').showModal();return;}state.authLocked=false;if($('login-dialog').open)$('login-dialog').close();const states=state.status.connections||[];const count=states.filter(c=>c.status!=='not_connected').length;$('connection-count').textContent=String(count);$('runtime-status').textContent=state.status.browserAvailable?'Local browser available':'Browser setup needed';renderConnections();renderSettings();}
  catch(error){$('runtime-status').textContent='Workspace unavailable';if(!$('login-dialog').open)notice(error.message);}
}
function renderConnections(){
  $('connection-grid').innerHTML=Object.keys(names).map(provider=>{const c=state.status?.connections?.find(c=>c.provider===provider);const status=c?.status==='error'?'Browser error':c?.status==='not_connected'||!c?'Not opened':'Browser open · sign-in unverified';return `<section class="panel connection-card"><div class="quote-top"><div class="quote-provider"><span class="provider-logo ${provider}">${marks[provider]}</span><h2>${names[provider]}</h2></div><span class="quote-status ${c?.status==='error'?'unavailable':''}">${status}</span></div><p>${escape(c?.message||'Open the provider browser, sign in, and prepare the trip or checkout you want to compare.')}</p><div class="connection-actions"><button class="primary" data-provider="${provider}">${c&&c.status!=='not_connected'?'Open browser':'Connect browser'} ↗</button>${c&&c.status!=='not_connected'?`<button class="secondary" data-disconnect="${provider}">Disconnect</button>`:''}</div></section>`;}).join('');
  if(state.status?.browserError)notice(`Browser setup: ${state.status.browserError}`);
}
function renderSettings(){
  $('local-browser-status').textContent=state.status?.browserAvailable?'Chromium is available. Open a provider browser from Connections.':`Browser unavailable. ${state.status?.browserError||'Install Chromium with npx playwright install chromium, then restart the server.'}`;
}
function addBasketItem(item={name:'',quantity:1,notes:''}){
  const row=document.createElement('div');row.className='basket-row';row.innerHTML=`<div class="row-fields"><input class="item-name" aria-label="Item name and size" required maxlength="200" placeholder="Item name and size" value="${escape(item.name)}"><input class="item-quantity" aria-label="Quantity" type="number" min="1" max="50" required value="${escape(item.quantity)}"><button type="button" class="icon-button remove-item" aria-label="Remove item">×</button></div><input class="item-notes" aria-label="Options and modifiers" maxlength="300" placeholder="Options, extras, and modifiers" value="${escape(item.notes)}">`;$('basket-items').append(row);
}
function readRequest(sector){
  const data=new FormData($(`${sector}-form`));
  if(sector==='rides')return {pickup:String(data.get('pickup')).trim(),destination:String(data.get('destination')).trim(),passengers:Number(data.get('passengers'))};
  return {address:String(data.get('address')).trim(),restaurant:String(data.get('restaurant')).trim(),tipCents:parseDollars(data.get('tip')),items:[...$('basket-items').querySelectorAll('.basket-row')].map(row=>({name:row.querySelector('.item-name').value.trim(),quantity:Number(row.querySelector('.item-quantity').value),notes:row.querySelector('.item-notes').value.trim()}))};
}
async function compare(sector,button){await busy(button,async()=>{clearNotice();const request=readRequest(sector);const result=await post(`/api/${sector}/compare`,request);state.comparisons[sector]=result;renderComparison(result);notice('Quotes captured. Check the exact trip or basket before confirming a quote.',true);});}
async function refreshComparison(id){try{const c=await api(`/api/comparisons/${id}`);renderComparison(c);}catch(error){notice(error.message);}}
function isEligible(c,q){return q.status==='verified'&&q.currency==='USD'&&q.sector===c.sector&&q.requestFingerprint===c.fingerprint&&Number.isSafeInteger(q.totalCents)&&q.totalCents>=0&&q.expiresAt&&Number.isFinite(Date.parse(q.expiresAt))&&Date.parse(q.expiresAt)>Date.now();}
function renderComparison(c){
  state.comparisons[c.sector]=c;
  const warningList=(c.warnings||[]).filter(Boolean);
  const quoteList=c.quotes||[];
  const count=c.ranking?.eligibleCount||0;
  const rankedProviders=new Set(quoteList.filter(q=>isEligible(c,q)).map(q=>q.provider));
  const timedProviders=new Set(quoteList.filter(q=>isEligible(c,q)&&Number.isFinite(q.etaMinutes)&&q.etaMinutes>=0).map(q=>q.provider));
  clearTimeout(state.expiryTimers[c.sector]);
  const nextExpiry=Math.min(...quoteList.map(q=>Date.parse(q.expiresAt||'')).filter(time=>Number.isFinite(time)&&time>Date.now()));
  if(Number.isFinite(nextExpiry))state.expiryTimers[c.sector]=setTimeout(()=>refreshComparison(c.id),Math.max(50,nextExpiry-Date.now()+50));
  const cheapestId=c.ranking?.cheapest?.id;
  const fastestId=c.ranking?.fastest?.id;
  const requestSummary=c.sector==='rides'?`${c.request.pickup} → ${c.request.destination} · ${c.request.passengers} passenger(s)`:`${c.request.restaurant} · ${c.request.address} · ${c.request.items.map(i=>`${i.quantity} × ${i.name}${i.notes?' ('+i.notes+')':''}`).join('; ')} · Tip ${dollars(c.request.tipCents)}`;
const checkText=c.sector==='rides'?'I checked the pickup, destination, passenger capacity, and equivalent ride category. This fare is in USD.':'I checked the restaurant branch, every item and option, delivery address and speed, and matching tip. This total is in USD.';
  const cards=quoteList.map(q=>{
    const expired=q.status!=='unavailable'&&q.expiresAt&&Date.parse(q.expiresAt)<=Date.now();
    const statusText=expired?'Expired · capture again':q.status==='verified'?'You verified this quote':q.status==='needs_confirmation'?'Needs your check':'Unavailable';
    const source=q.source==='manual'?'Your observed quote':q.source==='api'?'Provider API quote':'Captured from browser';
    const badges=[];if(rankedProviders.size>=2&&q.id===cheapestId)badges.push('Lowest verified cost');if(timedProviders.size>=2&&q.id===fastestId)badges.push('Shortest quoted ETA');
    const breakdown=q.breakdown?Object.entries(q.breakdown).filter(([,v])=>Number.isInteger(v)).map(([k,v])=>`${k.replace(/Cents$/,'').replace(/([A-Z])/g,' $1')}: ${dollars(v)}`).join('\n'):'';
    const canVerify=q.status==='needs_confirmation'&&Number.isInteger(q.totalCents)&&q.expiresAt&&Date.parse(q.expiresAt)>Date.now();
    return `<article class="quote-card ${escape(q.status)}"><div class="quote-top"><div class="quote-provider"><span class="provider-logo ${escape(q.provider)}">${marks[q.provider]||'?'}</span><div><h3>${names[q.provider]||escape(q.provider)}</h3><p>${escape(q.label)}</p></div></div><span class="quote-status ${expired?'unavailable':escape(q.status)}">${statusText}</span></div><div class="quote-price-row"><div class="quote-price">${dollars(q.totalCents)}<small>${source} · ${when(q.capturedAt)}</small></div><div class="quote-time">${q.etaMinutes!==null&&q.etaMinutes!==undefined?`<strong>${escape(q.etaMinutes)} min</strong>${c.sector==='rides'?'To destination':'Delivery estimate'}`:'ETA unavailable'}</div></div>${badges.length?`<div class="badges">${badges.map(b=>`<span class="badge">${b}</span>`).join('')}</div>`:''}${q.benefits?.length?`<p class="quote-benefits">${q.benefits.map(escape).join(' · ')}</p>`:''}${q.warnings?.length?`<div class="quote-warnings">${q.warnings.map(escape).join('<br>')}</div>`:''}${q.error?`<p class="quote-warnings">${escape(q.error)}</p>`:''}<details><summary>View captured evidence</summary>${breakdown?`<pre>${escape(breakdown)}</pre>`:''}<pre>${escape(q.evidence||'No price evidence was available.')}</pre><p>Capture: ${when(q.capturedAt)}. ${q.expiresAt?`App refresh deadline: ${when(q.expiresAt)}. Provider expiry is unknown.`:'Provider expiry is unknown; refresh before choosing.'}</p></details>${canVerify?`<label class="verify-check"><input type="checkbox" data-verify-check="${escape(q.id)}"><span>${checkText}</span></label>`:''}<div class="quote-actions">${canVerify?`<button class="primary" data-confirm="${escape(q.id)}" data-comparison="${escape(c.id)}" disabled>Confirm details</button>`:''}<button class="secondary" data-provider="${escape(q.provider)}">Open provider ↗</button></div></article>`;
  }).join('');
  $(`${c.sector}-results`).innerHTML=`<div class="result-heading"><h2>Your comparison</h2><span>${when(c.createdAt)}</span></div><div class="comparison-context"><strong>Captured request</strong><p>${escape(requestSummary)}</p></div>${warningList.length?`<div class="comparison-warning">${warningList.map(escape).join('<br>')}</div>`:''}<div class="quote-list">${cards||'<div class="panel"><h2>No quote could be captured.</h2><p class="muted">Open both providers and prepare the same request, or record an observed quote below.</p></div>'}</div><p class="ranking-note">${rankedProviders.size>=2?'Ranking includes only the equivalent quotes you verified.':'Confirm equivalent quotes from both providers to compare them.'} ${count?`${count} verified option${count===1?'':'s'}.`:''} Prices can change. An estimated ETA is not a guarantee.</p><details class="panel manual-panel"><summary>Record a quote you observed</summary><p>Use this when a page layout cannot be captured. You must check the same request yourself. These quotes are clearly labeled as your observations.</p><form class="manual-form" data-manual="${escape(c.id)}"><label>Provider<select name="provider">${sectors[c.sector].map(p=>`<option value="${p}">${names[p]}</option>`).join('')}</select></label><label>Ride category or basket label<input name="label" required maxlength="150" placeholder="${c.sector==='rides'?'e.g. standard car, 4 seats':'Exact basket checkout'}"></label><label>Total including matching tip (USD)<input name="total" required inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" placeholder="Enter observed total"></label><label>${c.sector==='rides'?'Time to destination (min, optional)':'Delivery ETA (min, optional)'}<input name="eta" type="number" min="1" max="1440" placeholder="Leave blank if unknown"></label><label class="wide">Applied benefits (optional)<input name="benefits" maxlength="300" placeholder="Only benefits actually applied to this quote"></label><label class="verify-check wide"><input name="verified" type="checkbox" required><span>${checkText} I entered the amount actually displayed by the provider.</span></label><button class="primary wide" type="submit">Save observed quote</button></form></details>`;
}
async function loadHistory(){
  try{const data=await api('/api/comparisons');const comparisons=Array.isArray(data)?data:data.comparisons||[];$('history-list').innerHTML=comparisons.length?comparisons.map(c=>`<article class="history-row"><span class="history-icon">${c.sector==='rides'?'↗':'◒'}</span><div><h3>${escape(c.sector==='rides'?`${c.request.pickup} → ${c.request.destination}`:c.request.restaurant)}</h3><p>${when(c.createdAt)} · ${escape(c.sector)} · ${c.ranking?.eligibleCount||0} verified quotes</p></div><button class="secondary" data-history="${escape(c.id)}">View</button></article>`).join(''):'<div class="empty-state"><h2>A fresh start.</h2><p>Your first comparison will appear here.</p></div>';}
  catch(error){notice(error.message);}
}
function restoreRequest(c){const form=$(`${c.sector}-form`);for(const [key,value] of Object.entries(c.request)){if(key==='items'){ $('basket-items').replaceChildren();value.forEach(addBasketItem);}else if(key==='tipCents')form.elements.tip.value=(value/100).toFixed(2);else if(form.elements[key])form.elements[key].value=value;}}
async function openProvider(provider,button){
  if(!names[provider])return;
  const work=async()=>{state.provider=provider;$('browser-title').textContent=`${names[provider]} browser`;$('browser-description').textContent='Sign in directly with the provider and prepare your trip or checkout.';$('browser-message').textContent='Opening your provider browser…';$('browser-url').value='';$('browser-image').removeAttribute('src');if(!$('browser-dialog').open)$('browser-dialog').showModal();const result=await post(`/api/connections/${provider}/open`,{});$('browser-url').value=result.url||result.connection?.url||'';await refreshScreenshot();await refreshStatus();};
  try{if(button)await busy(button,work);else await work();}catch(error){$('browser-message').textContent=error.message;notice(error.message);}
}
async function refreshScreenshot(){
  if(!state.provider)return;
  const provider=state.provider;state.browserBusy=true;$('browser-loading').classList.remove('hidden');
  try{const response=await fetch(`/api/browser/${provider}/screenshot?t=${Date.now()}`,{headers:{'X-MVP-Client':'dashboard'},credentials:'same-origin'});if(!response.ok){const data=await response.json().catch(()=>({error:'Could not capture the provider browser.'}));throw new Error(data.error?.message||data.error||'Could not capture the provider browser.');}const blob=await response.blob();if(state.provider!==provider)return;if(state.screenshot)URL.revokeObjectURL(state.screenshot);state.screenshot=URL.createObjectURL(blob);$('browser-image').src=state.screenshot;$('browser-message').textContent='Click the image to select a field or button. Enter text below to type into the selected field.';}
  catch(error){$('browser-message').textContent=error.message;}
  finally{state.browserBusy=false;$('browser-loading').classList.add('hidden');}
}
async function browserAction(action){
  if(state.browserBusy||!state.provider)return;
  state.browserBusy=true;$('browser-loading').classList.remove('hidden');
  try{const result=await post(`/api/browser/${state.provider}/action`,action);if(result.url)$('browser-url').value=result.url;await refreshScreenshot();}
  catch(error){$('browser-message').textContent=error.message;}
  finally{state.browserBusy=false;$('browser-loading').classList.add('hidden');}
}
document.addEventListener('click',async(event)=>{
  const view=event.target.closest('[data-view]');if(view){showView(view.dataset.view);return;}
  const provider=event.target.closest('[data-provider]');if(provider){await openProvider(provider.dataset.provider,provider);return;}
  const disconnect=event.target.closest('[data-disconnect]');if(disconnect){await busy(disconnect,async()=>{await api(`/api/connections/${disconnect.dataset.disconnect}`,{method:'DELETE'});await refreshStatus();notice(`${names[disconnect.dataset.disconnect]} session removed.`,true);});return;}
  const confirm=event.target.closest('[data-confirm]');if(confirm){await busy(confirm,async()=>{const c=await post(`/api/comparisons/${confirm.dataset.comparison}/quotes/${confirm.dataset.confirm}/confirm`,{confirmed:true});renderComparison(c);notice('Quote details confirmed.',true);});return;}
  const history=event.target.closest('[data-history]');if(history){await busy(history,async()=>{const c=await api(`/api/comparisons/${history.dataset.history}`);showView(c.sector);restoreRequest(c);renderComparison(c);});return;}
  const remove=event.target.closest('.remove-item');if(remove){if($('basket-items').children.length>1)remove.closest('.basket-row').remove();return;}
  const key=event.target.closest('[data-key]');if(key){await browserAction({type:'key',key:key.dataset.key});return;}
  const scroll=event.target.closest('[data-scroll]');if(scroll)await browserAction({type:'scroll',delta:Number(scroll.dataset.scroll)});
});
document.addEventListener('change',event=>{if(event.target.dataset.verifyCheck){const button=document.querySelector(`[data-confirm="${CSS.escape(event.target.dataset.verifyCheck)}"]`);if(button)button.disabled=!event.target.checked;}});
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(form.dataset.manual){event.preventDefault();await busy(form.querySelector('button[type="submit"]'),async()=>{const data=new FormData(form);const body={provider:data.get('provider'),label:String(data.get('label')).trim(),totalCents:parseDollars(data.get('total')),benefits:String(data.get('benefits')).trim()?String(data.get('benefits')).split(',').map(s=>s.trim()).filter(Boolean):[]};if(data.get('eta'))body.etaMinutes=Number(data.get('eta'));const result=await post(`/api/comparisons/${form.dataset.manual}/manual`,body);renderComparison(result);notice('Your observed quote was saved and labeled as a manual observation.',true);});}
});
$('rides-form').addEventListener('submit',event=>{event.preventDefault();compare('rides',event.target.querySelector('button[type="submit"]'));});
$('eats-form').addEventListener('submit',event=>{event.preventDefault();compare('eats',event.target.querySelector('button[type="submit"]'));});
$('add-item').addEventListener('click',()=>addBasketItem());
$('refresh-history').addEventListener('click',loadHistory);
$('close-browser').addEventListener('click',()=>{$('browser-dialog').close();$('browser-text').value='';});
$('browser-refresh').addEventListener('click',refreshScreenshot);
$('browser-navigate').addEventListener('click',()=>browserAction({type:'navigate',url:$('browser-url').value.trim()}));
$('browser-type').addEventListener('click',()=>{const text=$('browser-text').value;$('browser-text').value='';if(text)browserAction({type:'type',text});});
$('browser-text').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('browser-type').click();}});
$('browser-image').addEventListener('click',event=>{const image=event.currentTarget;const rect=image.getBoundingClientRect();if(!image.naturalWidth||!rect.width)return;const x=Math.max(0,Math.min(image.naturalWidth-1,Math.round((event.clientX-rect.left)*image.naturalWidth/rect.width)));const y=Math.max(0,Math.min(image.naturalHeight-1,Math.round((event.clientY-rect.top)*image.naturalHeight/rect.height)));browserAction({type:'click',x,y});});
$('login-dialog').addEventListener('cancel',event=>{if(state.authLocked)event.preventDefault();});
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await post('/api/login',{password:event.target.elements.password.value});event.target.reset();$('login-dialog').close();await refreshStatus();}catch(error){$('login-error').textContent=error.message;}finally{button.disabled=false;}});
window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(view!==state.view)showView(view);});
addBasketItem();showView(location.hash.slice(1)||'rides');refreshStatus();
