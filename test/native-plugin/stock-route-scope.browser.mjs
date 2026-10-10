import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {after,before,test} from 'node:test';
import {chromium} from 'playwright-core';
import {createTrackedRoute,withTrackedRoute} from './stock-route-scope.mjs';

const deferred=()=>{
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
};
const observed=promise=>promise.then(value=>({value}),error=>({error}));
let browser,server,origin;
const deliveries=new Map();
before(async()=>{
  server=createServer((request,response)=>{
    deliveries.set(request.url,(deliveries.get(request.url)??0)+1);
    if(request.url==='/') {
      response.writeHead(200,{'content-type':'text/html'});
      response.end('<!doctype html><title>Controlled route lifecycle</title>');
    } else {
      response.writeHead(200,{'content-type':'application/json'});
      response.end(JSON.stringify({result:{ok:true,value:{pluginVersion:'1.1.4',clientProtocol:2}},url:request.url}));
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  const executablePath=process.env.DSH_BOT_CHROMIUM || (existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  browser=await chromium.launch({executablePath,args:['--no-sandbox']});
});
after(async()=>{
  await browser?.close();
  if(server)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
});
const fixture=async()=>{
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(origin);
  return {context,page};
};

test('close drains a held genuine reply before reload and passes new requests through', {timeout:10000},async()=>{
  const {context,page}=await fixture(),ready=deferred(),release=deferred();
  let calls=0,scope,closing,request;
  try {
    scope=await createTrackedRoute(page,'**/snapshot*',async route=>{
      calls++;
      const response=await route.fetch(),body=await response.json();
      ready.resolve();await release.promise;
      delete body.result.value.pluginVersion;
      delete body.result.value.clientProtocol;
      await route.fulfill({response,json:body});
    });
    request=observed(page.evaluate(()=>fetch('/snapshot?held').then(response=>response.json())));
    await ready.promise;
    let closed=false;
    closing=observed(scope.close().then(()=>{closed=true;}));
    const during=await page.evaluate(()=>fetch('/snapshot?closing').then(response=>response.json()));
    assert.equal(during.result.value.pluginVersion,'1.1.4');
    assert.equal(calls,1,'new requests during close must bypass the controlled callback');
    assert.equal(closed,false,'close must wait for the original reply');
    release.resolve();
    const first=await request;
    assert.equal(first.error,undefined);
    assert.deepEqual(first.value.result.value,{});
    assert.equal((await closing).error,undefined);
    await scope.close();
    await page.reload({waitUntil:'domcontentloaded'});
    const after=await page.evaluate(()=>fetch('/snapshot?after').then(response=>response.json()));
    assert.equal(after.result.value.clientProtocol,2);
    assert.equal(calls,1);
  } finally {
    release.resolve();
    if(closing)await closing;
    else if(scope)await scope.close();
    if(request)await request;
    await context.close();
  }
});

test('a late reply failure after premature unroute and reload is retained by awaited close', {timeout:10000},async()=>{
  const {context,page}=await fixture(),ready=deferred(),release=deferred();
  let scope,request,original;
  try {
    scope=await createTrackedRoute(page,'**/snapshot*',async route=>{
      const response=await route.fetch();ready.resolve();await release.promise;
      try {await route.fulfill({response});}
      catch(error) {original=error;throw error;}
    });
    request=observed(page.evaluate(()=>fetch('/snapshot?held').then(response=>response.json())));
    await ready.promise;
    await page.unroute('**/snapshot*');
    await page.reload({waitUntil:'domcontentloaded'});
    release.resolve();
    const outcome=await observed(scope.close());
    assert.ok(original instanceof Error);
    assert.match(original.message,/Route is already handled/);
    assert.ok(outcome.error instanceof AggregateError);
    assert.equal(outcome.error.cause,original);
    assert.equal(outcome.error.errors[0],original);
    assert.match(outcome.error.errors[1].message,/Route is already handled/,'failed abort must also be retained');
    const again=await observed(scope.close());
    assert.equal(again.error.cause,original);
    assert.deepEqual(again.error.errors,outcome.error.errors);
  } finally {
    release.resolve();
    if(scope)await observed(scope.close());
    if(request)await request;
    await context.close();
  }
});

test('an early callback assertion actually fails the request and preserves the original error', {timeout:10000},async()=>{
  const {context,page}=await fixture(),entered=deferred(),failed=deferred();
  const before=deliveries.get('/early')??0;
  const original=new assert.AssertionError({message:'controlled early native reply assertion',actual:false,expected:true});
  let scope,request;
  try {
    page.on('requestfailed',request=>{if(request.url().endsWith('/early'))failed.resolve(request.failure());});
    scope=await createTrackedRoute(page,'**/early',async route=>{
      const response=await route.fetch();assert.equal(response.status(),200);
      entered.resolve();throw original;
    });
    request=observed(page.evaluate(()=>fetch('/early').then(response=>response.json())));
    await entered.promise;
    await scope.drain();
    assert.deepEqual(scope.failures,[original]);
    assert.throws(()=>scope.throwFailure(),error=>error===original);
    const outcome=await observed(scope.close());
    assert.equal(outcome.error,original);
    assert.match((await failed.promise).errorText,/ERR_FAILED/);
    assert.ok((await request).error,'the actual browser fetch must settle as failed');
    assert.equal((deliveries.get('/early')??0)-before,1,'a fetched original request must not be redelivered after failure');
    assert.equal((await observed(scope.close())).error,original);
    const next=await page.evaluate(()=>fetch('/early').then(response=>response.json()));
    assert.equal(next.result.ok,true,'cleanup must remove the failed callback');
  } finally {
    if(scope)await observed(scope.close());
    if(request)await request;
    await context.close();
  }
});

test('callback and UI errors are both retained without aborting an already fulfilled request', {timeout:10000},async()=>{
  const {context,page}=await fixture(),completed=deferred();
  const callbackError=new assert.AssertionError({message:'controlled reply assertion',actual:1,expected:2});
  const uiError=new Error('original controlled UI failure');
  try {
    const outcome=await observed(withTrackedRoute(page,'**/snapshot',async route=>{
      const response=await route.fetch();await route.fulfill({response});
      completed.resolve();throw callbackError;
    },async()=>{
      const response=await page.evaluate(()=>fetch('/snapshot').then(response=>response.json()));
      assert.equal(response.result.ok,true);
      await completed.promise;
      throw uiError;
    }));
    assert.ok(outcome.error instanceof AggregateError);
    assert.deepEqual(outcome.error.errors,[callbackError,uiError]);
    assert.equal(outcome.error.cause,callbackError);
    const next=await page.evaluate(()=>fetch('/snapshot').then(response=>response.json()));
    assert.equal(next.result.value.clientProtocol,2);
  } finally {await context.close();}
});

test('exceptional UI cleanup waits for a held reply before preserving the UI failure', {timeout:10000},async()=>{
  const {context,page}=await fixture(),ready=deferred(),release=deferred(),uiFailed=deferred();
  const original=new Error('controlled interrupted UI work');
  let work,request;
  try {
    work=observed(withTrackedRoute(page,'**/snapshot*',async route=>{
      const response=await route.fetch();ready.resolve();await release.promise;
      await route.fulfill({response});
    },async()=>{
      request=observed(page.evaluate(()=>fetch('/snapshot?held').then(response=>response.json())));
      await ready.promise;uiFailed.resolve();throw original;
    }));
    await uiFailed.promise;
    const during=await page.evaluate(()=>fetch('/snapshot?closing').then(response=>response.json()));
    assert.equal(during.result.ok,true);
    release.resolve();
    assert.equal((await work).error,original);
    assert.equal((await request).error,undefined);
    await page.reload({waitUntil:'domcontentloaded'});
  } finally {
    release.resolve();
    if(work)await work;
    if(request)await request;
    await context.close();
  }
});

test('close reports a closed-page unregister failure through its awaited result', {timeout:10000},async()=>{
  const {context,page}=await fixture(),ready=deferred(),release=deferred();
  let scope,request;
  try {
    scope=await createTrackedRoute(page,'**/snapshot',async route=>{
      const response=await route.fetch();ready.resolve();await release.promise;
      await route.fulfill({response});
    });
    request=observed(page.evaluate(()=>fetch('/snapshot').then(response=>response.json())));
    await ready.promise;await page.close();release.resolve();
    const outcome=await observed(scope.close());
    assert.ok(outcome.error instanceof Error);
    assert.match(outcome.error.message,/page\.unroute: Target page, context or browser has been closed/);
    assert.equal((await observed(scope.close())).error,outcome.error);
    assert.ok((await request).error);
  } finally {
    release.resolve();
    if(scope)await observed(scope.close());
    if(request)await request;
    await context.close();
  }
});
