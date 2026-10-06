import test from 'node:test';
import assert from 'node:assert/strict';
import type {Request} from 'playwright';
import {allowedBrowserRequest} from '../src/browser.js';

function navigation(url: string): Request {
  return {url:()=>url, isNavigationRequest:()=>true, frame:()=>{
    throw new Error('Frame for this navigation request is not available');
  }} as unknown as Request;
}
test('initial provider navigation does not require a frame that is not created yet',()=>{
  assert.equal(allowedBrowserRequest('uber',navigation('https://auth.uber.com/login')),true);
});
test('frameless navigation still rejects unrelated and private destinations',()=>{
  for (const url of ['https://evil.test/','https://127.0.0.1/','https://localhost/'])
    assert.equal(allowedBrowserRequest('uber',navigation(url)),false,url);
});
