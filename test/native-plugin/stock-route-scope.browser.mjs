import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {after,before,beforeEach,test} from 'node:test';
import {chromium} from 'playwright-core';
import {createTrackedRoute,withTrackedRoute} from './stock-route-scope.mjs';

const deferred=signal=>{
  let finish;
  const promise=new Promise(done=>{finish=done;});
  const resolve=value=>{signal?.removeEventListener('abort',resolve);finish(value);};
  signal?.addEventListener('abort',resolve,{once:true});
  if(signal?.aborted)resolve();
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
const fixtures=new Map();
// Renderer creation and navigation have their own bounded setup budget. They
// must not consume the shorter deadline used to verify held route behavior.
beforeEach(async t=>{
  const allocation=observed(browser.newContext());
  let closing,invalidated=false;
  const close=()=>closing??=(async()=>{
    const allocated=await allocation;
    if(allocated.error)return {};
    return observed(allocated.value.close());
  })();
  const abort=()=>{invalidated=true;void close();};
  t.signal.addEventListener('abort',abort,{once:true});
  // Register ownership before awaiting allocation: a cancelled test does not
  // immediately enter its async body's finally block.
  t.after(async()=>{
    invalidated=true;
    t.signal.removeEventListener('abort',abort);
    fixtures.delete(t.name);
    const outcome=await close();
    if(outcome.error)throw outcome.error;
  },{timeout:30000});
  try {
    const allocated=await allocation;
    if(allocated.error)throw allocated.error;
    const context=allocated.value;
    t.signal.throwIfAborted();
    if(invalidated)throw new Error('Browser fixture setup expired before context allocation');
    const page=await context.newPage();
    await page.goto(origin);
    t.signal.throwIfAborted();
    if(invalidated)throw new Error('Browser fixture setup expired before navigation completed');
    fixtures.set(t.name,{context,page});
  } catch(error) {
    const outcome=await close();
    if(outcome.error && outcome.error!==error)throw new AggregateError([error,outcome.error],'Browser fixture failed',{cause:error});
    throw error;
  }
},{timeout:30000});
const ownCleanup=(t,cleanup)=>{
  let closing,primary;
  const close=error=>{
    if(error!==undefined)primary??=error;
    return closing??=(async()=>{
      try {await cleanup();}
      catch(error) {
        if(primary && primary!==error)throw new AggregateError([primary,error],'Route fixture and cleanup failed',{cause:primary});
        throw error;
      }
    })();
  };
  t.after(()=>close(),{timeout:10000});
  return close;
};
const settleCleanup=async(context,...work)=>{
  const outcomes=await Promise.allSettled(work);
  const closed=await observed(context.close());
  if(closed.error)outcomes.push({status:'rejected',reason:closed.error});
  const errors=outcomes.filter(outcome=>outcome.status==='rejected').map(outcome=>outcome.reason);
  if(errors.length===1)throw errors[0];
  if(errors.length)throw new AggregateError(errors,'Route fixture cleanup failed',{cause:errors[0]});
};
const waitReady=async(ready,request,scope,signal)=>{
  const first=await Promise.race([
    ready.promise.then(()=>({ready:true})),
    request.then(outcome=>({outcome})),
  ]);
  signal.throwIfAborted();
  if(first.outcome) {
    // The real request can fail before the callback reaches its held gate.
    // Surface the original tracked callback failure instead of waiting forever
    // for a ready notification that will never arrive.
    await scope.drain();scope.throwFailure();
    if(first.outcome.error)throw first.outcome.error;
    throw new Error('Controlled request settled before its ready gate');
  }
};

test('close drains a held genuine reply before reload and passes new requests through', {timeout:10000},async t=>{
  const {context,page}=fixtures.get(t.name),ready=deferred(t.signal),release=deferred(t.signal);
  let calls=0,scope,closing,request;
  const cleanup=ownCleanup(t,async()=>{
    release.resolve();
    const routeClose=closing?closing.then(outcome=>{if(outcome.error)throw outcome.error;}):scope?.close();
    await settleCleanup(context,routeClose,request);
  });
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
    await waitReady(ready,request,scope,t.signal);
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
  } catch(error) {await cleanup(error);throw error;} finally {await cleanup();}
});

test('a late reply failure after premature unroute and reload is retained by awaited close', {timeout:10000},async t=>{
  const {context,page}=fixtures.get(t.name),ready=deferred(t.signal),release=deferred(t.signal);
  let scope,request,original;
  const cleanup=ownCleanup(t,async()=>{
    release.resolve();
    await settleCleanup(context,scope?observed(scope.close()):undefined,request);
  });
  try {
    scope=await createTrackedRoute(page,'**/snapshot*',async route=>{
      const response=await route.fetch();ready.resolve();await release.promise;
      try {await route.fulfill({response});}
      catch(error) {original=error;throw error;}
    });
    request=observed(page.evaluate(()=>fetch('/snapshot?held').then(response=>response.json())));
    await waitReady(ready,request,scope,t.signal);
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
  } catch(error) {await cleanup(error);throw error;} finally {await cleanup();}
});

test('an early callback assertion actually fails the request and preserves the original error', {timeout:10000},async t=>{
  const {context,page}=fixtures.get(t.name),entered=deferred(t.signal),failed=deferred(t.signal);
  const before=deliveries.get('/early')??0;
  const original=new assert.AssertionError({message:'controlled early native reply assertion',actual:false,expected:true});
  let scope,request;
  const cleanup=ownCleanup(t,async()=>{
    await settleCleanup(context,scope?observed(scope.close()):undefined,request);
  });
  try {
    page.on('requestfailed',request=>{if(request.url().endsWith('/early'))failed.resolve(request.failure());});
    scope=await createTrackedRoute(page,'**/early',async route=>{
      const response=await route.fetch();assert.equal(response.status(),200);
      entered.resolve();throw original;
    });
    request=observed(page.evaluate(()=>fetch('/early').then(response=>response.json())));
    await waitReady(entered,request,scope,t.signal);
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
  } catch(error) {await cleanup(error);throw error;} finally {await cleanup();}
});

test('callback and UI errors are both retained without aborting an already fulfilled request', {timeout:10000},async t=>{
  const {context,page}=fixtures.get(t.name),completed=deferred(t.signal);
  const callbackError=new assert.AssertionError({message:'controlled reply assertion',actual:1,expected:2});
  const uiError=new Error('original controlled UI failure');
  let work;
  const cleanup=ownCleanup(t,async()=>{await settleCleanup(context,work);});
  try {
    work=observed(withTrackedRoute(page,'**/snapshot',async route=>{
      const response=await route.fetch();await route.fulfill({response});
      completed.resolve();throw callbackError;
    },async()=>{
      const response=await page.evaluate(()=>fetch('/snapshot').then(response=>response.json()));
      assert.equal(response.result.ok,true);
      await completed.promise;t.signal.throwIfAborted();
      throw uiError;
    }));
    const outcome=await work;
    assert.ok(outcome.error instanceof AggregateError);
    assert.deepEqual(outcome.error.errors,[callbackError,uiError]);
    assert.equal(outcome.error.cause,callbackError);
    const next=await page.evaluate(()=>fetch('/snapshot').then(response=>response.json()));
    assert.equal(next.result.value.clientProtocol,2);
  } catch(error) {await cleanup(error);throw error;} finally {await cleanup();}
});

test('exceptional UI cleanup waits for a held reply before preserving the UI failure', {timeout:10000},async t=>{
  const {context,page}=fixtures.get(t.name),ready=deferred(t.signal),release=deferred(t.signal),uiFailed=deferred(t.signal);
  const original=new Error('controlled interrupted UI work');
  let work,request;
  const cleanup=ownCleanup(t,async()=>{
    release.resolve();
    await settleCleanup(context,work,request);
  });
  try {
    work=observed(withTrackedRoute(page,'**/snapshot*',async route=>{
      const response=await route.fetch();ready.resolve();await release.promise;
      await route.fulfill({response});
    },async()=>{
      request=observed(page.evaluate(()=>fetch('/snapshot?held').then(response=>response.json())));
      const first=await Promise.race([ready.promise.then(()=>({ready:true})),request.then(outcome=>({outcome}))]);
      t.signal.throwIfAborted();
      if(first.outcome?.error)throw first.outcome.error;
      if(first.outcome)throw new Error('Controlled request settled before its ready gate');
      uiFailed.resolve();throw original;
    }));
    const early=await Promise.race([uiFailed.promise.then(()=>({ready:true})),work.then(outcome=>({outcome}))]);
    t.signal.throwIfAborted();
    if(early.outcome)throw early.outcome.error??new Error('Controlled UI work settled before its gate');
    const during=await page.evaluate(()=>fetch('/snapshot?closing').then(response=>response.json()));
    assert.equal(during.result.ok,true);
    release.resolve();
    assert.equal((await work).error,original);
    assert.equal((await request).error,undefined);
    await page.reload({waitUntil:'domcontentloaded'});
  } catch(error) {await cleanup(error);throw error;} finally {await cleanup();}
});

test('close reports a closed-page unregister failure through its awaited result', {timeout:10000},async t=>{
  const {context,page}=fixtures.get(t.name),ready=deferred(t.signal),release=deferred(t.signal);
  let scope,request;
  const cleanup=ownCleanup(t,async()=>{
    release.resolve();
    await settleCleanup(context,scope?observed(scope.close()):undefined,request);
  });
  try {
    scope=await createTrackedRoute(page,'**/snapshot',async route=>{
      const response=await route.fetch();ready.resolve();await release.promise;
      await route.fulfill({response});
    });
    request=observed(page.evaluate(()=>fetch('/snapshot').then(response=>response.json())));
    await waitReady(ready,request,scope,t.signal);await page.close();release.resolve();
    const outcome=await observed(scope.close());
    assert.ok(outcome.error instanceof Error);
    assert.match(outcome.error.message,/page\.unroute: Target page, context or browser has been closed/);
    assert.equal((await observed(scope.close())).error,outcome.error);
    assert.ok((await request).error);
  } catch(error) {await cleanup(error);throw error;} finally {await cleanup();}
});
