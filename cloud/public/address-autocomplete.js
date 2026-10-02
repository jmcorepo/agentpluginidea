/** Address lookup only. Selected labels still need independent provider validation. */
export function attachAddressAutocomplete(input,{fetchImpl=fetch,delay=300}={}){
  if(input.dataset.addressAutocompleteBound)return null;
  input.dataset.addressAutocompleteBound='true';
  const base=input.id||`address-${input.name}`;input.id=base;
  const label=input.closest('label');
  const wrapper=document.createElement('div');wrapper.className='address-lookup';
  (label||input).before(wrapper);wrapper.append(label||input);
  const list=document.createElement('ul');list.id=`${base}-suggestions`;list.className='address-suggestions';list.setAttribute('role','listbox');list.setAttribute('aria-label','Address suggestions');list.hidden=true;
  const status=document.createElement('p');status.id=`${base}-lookup-status`;status.className='address-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const credit=document.createElement('p');credit.className='address-attribution';credit.hidden=true;
  wrapper.append(list,status,credit);
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');input.setAttribute('autocomplete','off');input.setAttribute('spellcheck','false');input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),status.id].filter(Boolean).join(' '));
  let generation=0,timer,controller,items=[],active=-1,pending=false;
  function close(){list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
  function cancel(){generation++;clearTimeout(timer);controller?.abort();controller=null;pending=false;}
  function current(token,query){return token===generation&&input.value.trim()===query&&document.activeElement===input;}
  function highlight(index){active=index;[...list.children].forEach((option,i)=>option.setAttribute('aria-selected',String(i===active)));if(active>=0){input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
  function choose(index){const item=items[index];if(!item)return;cancel();input.value=item.label;input.dataset.addressId=item.id;input.dataset.addressLatitude=String(item.latitude);input.dataset.addressLongitude=String(item.longitude);close();items=[];status.textContent='Address selected. You can edit it.';input.focus();input.dispatchEvent(new Event('change',{bubbles:true}));}
  function showCredit(attribution){credit.replaceChildren();const text=document.createElement('span');text.textContent=attribution||'© OpenStreetMap contributors; search by Photon';const link=document.createElement('a');link.href='https://www.openstreetmap.org/copyright';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Attribution';credit.append(text,' · ',link);credit.hidden=false;}
  async function search(token,query){
    if(!current(token,query))return;
    controller=new AbortController();pending=true;status.textContent='Looking up addresses…';
    try{
      const response=await fetchImpl(`/api/addresses/search?q=${encodeURIComponent(query)}`,{credentials:'same-origin',headers:{'X-MVP-Client':'dashboard'},signal:controller.signal});
      if(!response.ok)throw new Error('Address search unavailable');
      const data=await response.json();if(!current(token,query))return;
      if(!Array.isArray(data.suggestions))throw new Error('Invalid address response');
      items=data.suggestions.filter(item=>item&&typeof item.id==='string'&&typeof item.label==='string'&&item.label.trim()&&item.label.length<=300&&Number.isFinite(item.latitude)&&Number.isFinite(item.longitude)).slice(0,8);
      list.replaceChildren();items.forEach((item,index)=>{const option=document.createElement('li');option.id=`${base}-suggestion-${token}-${index}`;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.textContent=item.label;option.addEventListener('click',()=>{if(current(token,query))choose(index);});list.append(option);});
      showCredit(typeof data.attribution==='string'?data.attribution:undefined);
      if(items.length){list.hidden=false;input.setAttribute('aria-expanded','true');status.textContent=`${items.length} address suggestion${items.length===1?'':'s'} available. Use arrow keys and Enter to select.`;}
      else{close();status.textContent='No matching addresses. Keep typing or enter the full address manually.';}
    }catch(error){if(current(token,query)&&error.name!=='AbortError'){items=[];close();status.textContent='Address lookup is unavailable. Enter the full address manually.';}}
    finally{if(token===generation){pending=false;controller=null;}}
  }
  function schedule(){cancel();items=[];close();credit.hidden=true;delete input.dataset.addressId;delete input.dataset.addressLatitude;delete input.dataset.addressLongitude;const query=input.value.trim();if(query.length<3){status.textContent=query?'Type at least 3 characters for suggestions.':'';return;}const token=generation;pending=true;status.textContent='Waiting to look up addresses…';timer=setTimeout(()=>search(token,query),delay);}
  input.addEventListener('input',schedule);
  input.addEventListener('focus',()=>{if(!items.length)schedule();});
  input.addEventListener('blur',()=>{cancel();close();});
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if((event.key==='ArrowDown'||event.key==='ArrowUp')&&!list.hidden&&items.length){event.preventDefault();highlight(event.key==='ArrowDown'?(active+1)%items.length:(active<=0?items.length:active)-1);}
    else if(event.key==='Enter'&&!list.hidden&&items.length){event.preventDefault();event.stopPropagation();choose(active<0?0:active);}
    else if(event.key==='Enter'&&pending){event.preventDefault();}
    else if(event.key==='Escape'&&(pending||!list.hidden)){event.preventDefault();event.stopPropagation();cancel();close();status.textContent='Suggestions closed. You can keep typing or enter the address manually.';}
    else if(event.key==='Tab'){cancel();close();}
  });
  list.addEventListener('pointerdown',event=>event.preventDefault());
  return {close:()=>{cancel();close();}};
}
export function initAddressAutocomplete(root=document){return [...root.querySelectorAll('input[data-address-search]')].map(input=>attachAddressAutocomplete(input));}
