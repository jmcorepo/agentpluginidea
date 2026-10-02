const addressSearch = createAddressSearch((url,options)=>fetch(url,options));
const disconnectedMessage = 'Automatic browser runtime is not connected; local app or hosted Node container must be started.';
let session;
function reply(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
function runtimeConfig(env,clientOrigin){
  if(!env.RUNTIME_URL||!env.RUNTIME_PASSWORD)return null;
  const url=new URL(env.RUNTIME_URL);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(url.pathname!=='/'&&url.pathname!=='')||url.origin===clientOrigin||typeof env.RUNTIME_PASSWORD!=='string'||env.RUNTIME_PASSWORD.length<12)throw new Error('Invalid runtime configuration');
  return {origin:url.origin,password:env.RUNTIME_PASSWORD};
}
function upstreamHeaders(config,cookie,contentType){const headers=new Headers({'X-MVP-Client':'dashboard',Origin:config.origin});if(cookie)headers.set('Cookie',cookie);if(contentType)headers.set('Content-Type',contentType);return headers;}
async function login(config,force=false){
  if(!session||session.origin!==config.origin||session.password!==config.password)session={...config,cookie:null,until:0,pending:null};
  const current=session;
  if(current.pending)return current.pending;
  if(!force&&current.cookie&&current.until>Date.now())return current.cookie;
  current.pending=(async()=>{
    const response=await fetch(config.origin+'/api/login',{method:'POST',headers:upstreamHeaders(config,null,'application/json'),body:JSON.stringify({password:config.password}),redirect:'manual',signal:AbortSignal.timeout(70000)});
    if(!response.ok)throw new Error('Runtime authentication failed');
    const value=response.headers.get('Set-Cookie')||'';
    const match=value.match(/(?:^|,\s*)mvp_session=([^;\s,]+)/);
    if(!match)throw new Error('Runtime session was not issued');
    const maxAge=Number(value.match(/\bMax-Age=(\d+)/i)?.[1]||300);
    current.cookie='mvp_session='+match[1];current.until=Date.now()+Math.max(1,Math.min(maxAge,43200)-60)*1000;
    return current.cookie;
  })();
  try{return await current.pending;}finally{current.pending=null;}
}
function allowedEndpoint(path,method){
  if(method==='GET'&&['/api/status','/api/settings','/api/comparisons'].includes(path))return true;
  if(method==='POST'&&['/api/rides/compare','/api/eats/compare'].includes(path))return true;
  if(method==='GET'&&/^\/api\/(?:jobs|comparisons)\/[a-zA-Z0-9-]+$/.test(path))return true;
  if(method==='POST'&&/^\/api\/connections\/(?:uber|lyft|ubereats|doordash)\/open$/.test(path))return true;
  if(method==='DELETE'&&/^\/api\/connections\/(?:uber|lyft|ubereats|doordash)$/.test(path))return true;
  return (method==='GET'&&/^\/api\/browser\/(?:uber|lyft|ubereats|doordash)\/screenshot$/.test(path))||(method==='POST'&&/^\/api\/browser\/(?:uber|lyft|ubereats|doordash)\/action$/.test(path));
}
async function proxy(request,url,config){
  let body;
  if(request.method==='POST'){
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'Send JSON.'},415);
    if(Number(request.headers.get('Content-Length'))>65536)return reply({error:'Request too large.'},413);
    body=await request.text();if(new TextEncoder().encode(body).length>65536)return reply({error:'Request too large.'},413);
  }
  const target=new URL(config.origin);target.pathname=url.pathname;target.search=url.search;
  const send=cookie=>fetch(target.href,{method:request.method,headers:upstreamHeaders(config,cookie,body===undefined?null:'application/json'),body,redirect:'manual',signal:AbortSignal.timeout(30000)});
  let response=await send(await login(config));
  const locked=async r=>r.status===401||(url.pathname==='/api/status'&&r.ok&&(await r.clone().json()).authRequired===true);
  if(await locked(response)){response=await send(await login(config,true));if(await locked(response))throw new Error('Runtime authentication failed');}
  if(response.status>=300&&response.status<400)throw new Error('Runtime returned a redirect');
  if(url.pathname==='/api/status'&&response.ok){const data=await response.json();return reply({...data,authRequired:false,runtimeConnected:true});}
  // Keep session cookies, authorization headers and runtime secrets off the client.
  const headers=new Headers({'Content-Type':response.headers.get('Content-Type')||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  return new Response(response.body,{status:response.status,headers});
}
export default {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/')){
    const file=path==='/'?'index.html':path.slice(1);
    if(request.method!=='GET'||!Object.hasOwn(assets,file))return reply({error:'Not found.'},404);
    const mime={'index.html':'text/html','app.js':'text/javascript','address-autocomplete.js':'text/javascript','style.css':'text/css','favicon.svg':'image/svg+xml'};
    return new Response(assets[file],{headers:{'Content-Type':mime[file]+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'}});
  }
  const origin=request.headers.get('Origin');
  if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.get('X-MVP-Client')!=='dashboard')return reply({error:'Use this dashboard from the same origin.'},403);
  if(path==='/api/addresses/search'&&request.method==='GET'){
    try{return reply(await addressSearch(url.searchParams.get('q')||''));}
    catch(error){return reply({error:error.message},error.status||502);}
  }
  try{
    const config=runtimeConfig(env,url.origin);
    if(!config){
      if(path==='/api/status'&&request.method==='GET')return reply({mode:'cloud-runtime-disconnected',runtimeConnected:false,browserAvailable:false,authRequired:false,connections:[],purchasesEnabled:false,browserError:disconnectedMessage});
      return reply({error:disconnectedMessage},503);
    }
    if(!allowedEndpoint(path,request.method))return reply({error:'Not found. Manual quotes and dashboard password entry are not supported here.'},404);
    return await proxy(request,url,config);
  }catch{return reply({error:'Automatic browser runtime is unavailable. Check its HTTPS address, private connection password and running service.'},503);}
}};
