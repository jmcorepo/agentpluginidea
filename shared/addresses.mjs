// Shared by the Node API and the private cloud dashboard. No browser runtime needed.
export const addressAttribution = '© OpenStreetMap contributors; search by Photon';
const states = {
  Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',
  'District of Columbia':'DC',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY','Puerto Rico':'PR',
};
const clean=value=>typeof value==='string'?value.trim().slice(0,200):'';
export function normalizeAddressResults(data) {
  if (!data || !Array.isArray(data.features)) throw new Error('Address search returned an unsupported response.');
  const suggestions=[],labels=new Set();
  for (const feature of data.features.slice(0,30)) {
    const p=feature?.properties,coordinates=feature?.geometry?.coordinates;
    if (!p || feature.geometry?.type!=='Point' || !Array.isArray(coordinates)) continue;
    const [longitude,latitude]=coordinates;
    if (!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90) continue;
    const country=clean(p.countrycode).toUpperCase();
    if (country ? country!=='US' : !/^(?:United States(?: of America)?|USA|US)$/i.test(clean(p.country))) continue;
    const street=[clean(p.housenumber),clean(p.street)].filter(Boolean).join(' ');
    const state=states[clean(p.state)]??(Object.values(states).includes(clean(p.state).toUpperCase())?clean(p.state).toUpperCase():clean(p.state));
    const locality=clean(p.city)||clean(p.town)||clean(p.village)||clean(p.county);
    const parts=[street||clean(p.name),locality,[state,clean(p.postcode)].filter(Boolean).join(' ')].filter(Boolean);
    if (!parts.length || (!street && !clean(p.name))) continue;
    const label=parts.join(', ');
    if (labels.has(label.toLowerCase())) continue;
    labels.add(label.toLowerCase());
    suggestions.push({id:`${clean(p.osm_type)||'place'}-${String(p.osm_id??'')}-${longitude}-${latitude}`,label,latitude,longitude});
    if (suggestions.length===6) break;
  }
  return suggestions;
}
export function createAddressSearch(fetcher=fetch) {
  const pending=new Map();
  let windowStart=Date.now(),requests=0;
  return async function search(query) {
    if (typeof query!=='string' || query.trim().length>200) throw Object.assign(new Error('Enter an address up to 200 characters.'),{status:400});
    const q=query.trim();
    if(q.length<3) return {suggestions:[],attribution:addressAttribution};
    if(Date.now()-windowStart>=60000){windowStart=Date.now();requests=0;}
    const key=q.toLowerCase();
    if(pending.has(key))return pending.get(key);
    if(requests>=60)throw Object.assign(new Error('Address search is busy. Wait a moment or enter the address manually.'),{status:429});
    requests++;
    const work=(async()=>{
      const url=new URL('https://photon.komoot.io/api/');
      url.search=new URLSearchParams({q,limit:'12',lang:'en',countrycode:'US'}).toString();
      const response=await fetcher(url.href,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw Object.assign(new Error('Address suggestions are unavailable. You can enter the address manually.'),{status:502});
      return {suggestions:normalizeAddressResults(await response.json()),attribution:addressAttribution};
    })();
    pending.set(key,work);
    // Only coalesce in-flight requests; address fragments are not stored in history/cache.
    try{return await work;}catch(error){if(error.status)throw error;throw Object.assign(new Error('Address suggestions are unavailable. You can enter the address manually.'),{status:502});}
    finally{pending.delete(key);}
  };
}
