import test from 'node:test';
import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import {get,request} from 'node:http';
import {createApplication} from '../src/server.js';
import type {BrowserPool} from '../src/browser.js';
import type {Vault} from '../src/vault.js';

const vault = {read:async()=>null} as unknown as Vault;
const browser = {availability:()=>({browserAvailable:true}),states:()=>[],close:async()=>{}} as unknown as BrowserPool;
test('public passwordless access requires an explicit configuration choice',async()=>{
  await assert.rejects(()=>createApplication({port:3000,host:'0.0.0.0',vault,browser}),/requires MVP_PASSWORD/);
});
test('explicit passwordless configuration serves status without a dashboard login',async()=>{
  const app = await createApplication({port:3000,host:'0.0.0.0',allowUnauthenticated:true,vault,browser});
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
  try {
    const port = (app.server.address() as AddressInfo).port;
    const response = await new Promise<{status:number|undefined;body:string}>((resolve,reject)=>{
      get(`http://127.0.0.1:${port}/api/status`,{headers:{Host:'localhost:3000','X-MVP-Client':'dashboard'}},res=>{
        let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));
      }).on('error',reject);
    });
    assert.equal(response.status,200);
    assert.equal(JSON.parse(response.body).authRequired,false);
    const mcp=await new Promise<{status:number|undefined;body:string}>((resolve,reject)=>{
      const req=request(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{Host:'localhost:3000','Content-Type':'application/json',Accept:'application/json, text/event-stream'}},res=>{
        let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));
      });
      req.on('error',reject);req.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'integration-test',version:'1'}}}));
    });
    assert.equal(mcp.status,200);
    assert.equal(JSON.parse(mcp.body).result.serverInfo.name,'switchboard');
  } finally {await app.close();}
});
