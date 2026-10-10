import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
const {uiRpc}=await import(process.env.DSH_BOT_V111_RPC_MODULE??'./stock-v111-quality-checks.mjs');

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const observed=promise=>promise.then(value=>({value}),error=>({error}));
const events=['request','response','requestfailed','close'];
const counts=page=>events.map(name=>page.listenerCount(name));
async function fixture(t,reply=async()=>({result:{ok:true,value:'original real HTTP body'}})) {
  const requests=[],server=createServer(async(req,res)=>{
    if(req.url==='/') {res.setHeader('content-type','text/html');res.end('<button id="send">Send actual RPC</button><script>send.onclick=()=>fetch("/command",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({payload:{action:"memory.search"}})}).catch(()=>{})</script>');return;}
    if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
    let body='';for await(const chunk of req)body+=chunk;
    const request={url:req.url,envelope:body?JSON.parse(body):undefined};requests.push(request);
    try {const value=await reply(request);res.setHeader('content-type','application/json');res.end(typeof value==='string'?value:JSON.stringify(value));}
    catch(error){res.destroy(error);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({...(process.env.DSH_BOT_CHROMIUM?{executablePath:process.env.DSH_BOT_CHROMIUM}:{}),headless:true,args:process.platform==='linux'?['--no-sandbox']:[]});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage();page.setDefaultTimeout(1000);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const gui={page,app:{ctx:{dshBot:{store:{read:()=>({operations:{}})}}}}},baseline=counts(page);
  return {page,gui,baseline,requests,originalListeners:events.map(name=>page.listeners(name))};
}

test('v111 original actual response body is returned and listeners end',async t=>{
  const {page,gui,baseline,requests}=await fixture(t);
  const result=await uiRpc(gui,'memory.search',()=>page.locator('#send').click());
  assert.equal(result.value,'original real HTTP body');assert.equal(result.request.action,'memory.search');
  assert.equal(requests.length,1);assert.equal(requests[0].envelope.payload.action,'memory.search');
  assert.deepEqual(counts(page),baseline);
});

test('v111 matched real failed request rejects while page stays open', {timeout:15000},async t=>{
  const {page,gui,baseline}=await fixture(t);await page.route('**/command',route=>route.abort('failed'));
  const outcome=await observed(uiRpc(gui,'memory.search',()=>page.locator('#send').click()));
  assert.match(outcome.error?.message??'',/memory.search.*net::ERR_FAILED/);
  assert.equal(page.isClosed(),false);assert.equal(await page.evaluate(()=>document.readyState),'complete');
  assert.deepEqual(counts(page),baseline);
});

test('v111 same-action unrelated failure and response cannot replace the selected Request',async t=>{
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const {page,gui,baseline}=await fixture(t,async request=>{
    if(request.url==='/command'){entered.resolve();await release.promise;return {result:{ok:true,value:'selected original request'}};}
    return {result:{ok:true,value:'unrelated response'}};
  });
  await page.route('**/unrelated-failed',route=>route.abort('failed'));
  let settled=false;const pending=observed(uiRpc(gui,'memory.search',()=>page.locator('#send').click())).then(value=>{settled=true;return value;});
  await entered.promise;
  await page.evaluate(async()=>{
    const options={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payload:{action:'memory.search'}})};
    await fetch('/unrelated-failed',options).catch(()=>{});await fetch('/unrelated-response',options);
  });
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(settled,false,'Only the selected actual Request may settle this RPC');
  release.resolve();const outcome=await pending;assert.equal(outcome.error,undefined);assert.equal(outcome.value.value,'selected original request');
  assert.deepEqual(counts(page),baseline);
});

test('v111 interaction failure before any request retains the primary and stops observer',async t=>{
  const {page,gui,baseline,requests}=await fixture(t),primary=new Error('Original interaction failed before request');
  const outcome=await observed(uiRpc(gui,'memory.search',()=>{throw primary;}));
  assert.equal(outcome.error,primary);assert.equal(requests.length,0);assert.deepEqual(counts(page),baseline);
});

test('v111 explicit cancellation before any request retains cause and ends all listeners',async t=>{
  const {page,gui,baseline,requests}=await fixture(t),controller=new AbortController(),reason=new Error('Original route cleanup failed');
  let interactions=0;
  const pending=observed(uiRpc(gui,'memory.search',async()=>{interactions++;}, {signal:controller.signal}));
  controller.abort(reason);const outcome=await pending;
  assert.equal(outcome.error,reason);assert.equal(interactions,0);assert.equal(requests.length,0);assert.deepEqual(counts(page),baseline);
});

test('v111 bounded no-response timeout ends all listeners',async t=>{
  const {page,gui,baseline}=await fixture(t);
  const outcome=await observed(uiRpc(gui,'memory.search',async()=>{}, {timeout:40}));
  assert.equal(outcome.error?.name,'TimeoutError');assert.deepEqual(counts(page),baseline);
});

test('v111 page closure settles the active observer and removes its listeners',async t=>{
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const {page,gui,originalListeners}=await fixture(t,async()=>{entered.resolve();await release.promise;return {result:{ok:true,value:'not delivered'}};});
  const pending=observed(uiRpc(gui,'memory.search',()=>page.locator('#send').click()));
  await entered.promise;await page.close();const outcome=await pending;
  assert.match(outcome.error?.message??'',/closed/i);
  events.forEach((name,index)=>assert.ok(page.listeners(name).every(listener=>originalListeners[index].includes(listener)),`${name} has no remaining RPC-owned listener`));
});

test('v111 actual JSON and native receipt failures remain failures',async t=>{
  let malformed=true;const {page,gui,baseline}=await fixture(t,async()=>malformed?'{':{result:{ok:true,value:'reply without durable receipt'}});
  let outcome=await observed(uiRpc(gui,'memory.search',()=>page.locator('#send').click()));
  assert.equal(outcome.error?.name,'SyntaxError');assert.deepEqual(counts(page),baseline);
  malformed=false;
  await page.evaluate(()=>{send.onclick=()=>fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payload:{action:'memory.search',operationId:'actual-missing-receipt'}})}).catch(()=>{});});
  outcome=await observed(uiRpc(gui,'memory.search',()=>page.locator('#send').click()));
  assert.equal(outcome.error?.name,'AssertionError');assert.deepEqual(counts(page),baseline);
});
