import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Vault} from '../src/vault.js';
import {allowedProviderUrl, isPurchaseControl} from '../src/browser.js';
import {rankComparison, confirmQuote, fingerprint, quoteExpiry} from '../src/comparison.js';
import type {Comparison, Quote} from '../src/domain.js';

const request = {pickup:'Airport terminal',destination:'Hotel',passengers:2};
const fp = fingerprint('rides',request);
function quote(overrides: Partial<Quote> = {}): Quote {
  return {id:'one',provider:'uber',sector:'rides',status:'verified',source:'browser',label:'Standard',totalCents:2000,currency:'USD',
    capturedAt:new Date(1_000_000).toISOString(),expiresAt:quoteExpiry('rides',1_000_000),etaMinutes:10,
    benefits:[],warnings:[],evidence:'USD $20.00',requestFingerprint:fp,...overrides};
}
function comparison(quotes: Quote[]): Comparison {
  return {id:'c',fingerprint:fp,sector:'rides',request,quotes,warnings:[],createdAt:new Date(1_000_000).toISOString(),
    ranking:{cheapest:null,fastest:null,eligibleCount:0,excludedCount:0}};
}
test('ranking excludes unknown, unconfirmed, mismatched, expired and invalid amounts',()=>{
  const c=comparison([quote(),quote({id:'two',provider:'lyft',totalCents:2500,etaMinutes:5}),
    quote({id:'unknown',totalCents:null}),quote({id:'pending',status:'needs_confirmation',totalCents:1}),
    quote({id:'different',requestFingerprint:'wrong',totalCents:1}),quote({id:'expired',expiresAt:new Date(0).toISOString(),totalCents:1}),
    quote({id:'invalid',totalCents:NaN}),quote({id:'no-expiry',expiresAt:null})]);
  const result=rankComparison(c,1_000_100);
  assert.equal(result.ranking.cheapest?.id,'one');assert.equal(result.ranking.fastest?.id,'two');
  assert.equal(result.ranking.eligibleCount,2);assert.equal(result.ranking.excludedCount,6);
});
test('confirmation cannot revive an expired or unavailable quote',()=>{
  assert.throws(()=>confirmQuote(comparison([quote({expiresAt:new Date(0).toISOString()})]),'one',1_000_100),/expired/);
  assert.throws(()=>confirmQuote(comparison([quote({status:'unavailable',totalCents:null})]),'one',1_000_100),/no usable price/);
  const c=confirmQuote(comparison([quote({status:'needs_confirmation'})]),'one',1_000_100);
  assert.equal(c.ranking.eligibleCount,1);
});
test('a consciously verified explicit zero differs from a missing total',()=>{
  const c=rankComparison(comparison([quote({totalCents:0}),quote({id:'missing',totalCents:null})]),1_000_100);
  assert.equal(c.ranking.cheapest?.totalCents,0);assert.equal(c.ranking.eligibleCount,1);
});
test('provider navigation rejects credential, protocol and lookalike-host tricks',()=>{
  assert.equal(allowedProviderUrl('uber','https://m.uber.com/'),true);
  assert.equal(allowedProviderUrl('ubereats','https://auth.uber.com/',true),true);
  for(const url of ['http://m.uber.com/','https://uber.com.evil.test/','https://eviluber.com/',
    'https://uber.com@evil.test/','https://127.0.0.1/','https://m.uber.com:999/']) assert.equal(allowedProviderUrl('uber',url),false,url);
  assert.equal(allowedProviderUrl('lyft','https://accounts.google.com/',true),true);
  assert.equal(allowedProviderUrl('lyft','https://accounts.google.com/'),false);
});
test('remote interaction protects recognizable purchase controls while allowing sign-in',()=>{
  for(const label of ['Place order','Request UberX','Request Comfort','Confirm and pay','Book ride']) assert.equal(isPurchaseControl(label),true,label);
  for(const label of ['Sign in','Request code','Continue','Add to cart']) assert.equal(isPurchaseControl(label),false,label);
});
test('local storage encrypts data and survives concurrent writes and a restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'commerce-vault-'));
  try {
    const vault=new Vault(directory);await vault.init();
    await Promise.all([vault.write('sessions',{token:'synthetic-secret-for-test'}),vault.write('history',{count:1}),vault.write('history',{count:2})]);
    const raw=await readFile(join(directory,'sessions.enc'));
    assert.equal(raw.includes(Buffer.from('synthetic-secret-for-test')),false);
    const restored=new Vault(directory);await restored.init();
    assert.deepEqual(await restored.read('sessions'),{token:'synthetic-secret-for-test'});
    assert.deepEqual(await restored.read('history'),{count:2});
    await restored.remove('sessions');assert.equal(await restored.read('sessions'),null);
    await writeFile(join(directory,'history.enc'),Buffer.from('damaged'));
    await assert.rejects(()=>restored.read('history'),/damaged/);
    assert.equal((await readFile(join(directory,'history.enc'))).toString(),'damaged');
  } finally {await rm(directory,{recursive:true,force:true});}
});
