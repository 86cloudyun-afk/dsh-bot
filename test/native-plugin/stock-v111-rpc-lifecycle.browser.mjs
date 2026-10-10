import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect} from 'node:net';
import {chromium} from 'playwright-core';
const {uiRpc}=await import(process.env.DSH_BOT_V111_RPC_MODULE??'./stock-v111-quality-checks.mjs');

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const observed=promise=>promise.then(value=>({value}),error=>({error}));
const events=['request','response','requestfailed','close'];
const counts=page=>events.map(name=>page.listenerCount(name));
const releaseOnCleanup=(t,gate)=>{
  const release=()=>gate.resolve();t.signal.addEventListener('abort',release,{once:true});
  t.after(()=>{t.signal.removeEventListener('abort',release);release();});
};
async function fixture(t,reply=async()=>({result:{ok:true,value:'original real HTTP body'}})) {
  const requests=[],server=createServer(async(req,res)=>{
    if(req.url==='/') {res.setHeader('content-type','text/html');res.end('<button id="send">Send actual RPC</button><script>send.onclick=()=>fetch("/command",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({payload:{action:"memory.search"}})}).catch(()=>{})</script>');return;}
    if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
    try {
      let body='';for await(const chunk of req)body+=chunk;
      const request={url:req.url,envelope:body?JSON.parse(body):undefined};requests.push(request);
      const value=await reply(request);res.setHeader('content-type','application/json');res.end(typeof value==='string'?value:JSON.stringify(value));
    }
    catch(error){res.destroy(error);}
  });
  let browser,closing=false,cleanup,closingBrowser;
  const closeBrowser=()=>browser?(closingBrowser??=browser.close()):Promise.resolve();
  const dispose=()=>{
    closing=true;
    return cleanup??=(async()=>{try{await closeBrowser();}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}})();
  };
  t.after(dispose);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  if(closing)throw t.signal.reason??new Error('Fixture cleanup already started');
  browser=await chromium.launch({...(process.env.DSH_BOT_CHROMIUM?{executablePath:process.env.DSH_BOT_CHROMIUM}:{}),headless:true,args:process.platform==='linux'?['--no-sandbox']:[]});
  if(closing){await closeBrowser();throw t.signal.reason??new Error('Fixture cleanup already started');}
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
  const entered=deferred(),release=deferred();releaseOnCleanup(t,release);
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
  const entered=deferred(),release=deferred();releaseOnCleanup(t,release);
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

test('v111 missing browser startup closes the real HTTP fixture and exits with the original error',{timeout:16000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-v111-startup-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const missing=join(root,'missing-chromium');
  const observer=`import {Server} from 'node:http';const listen=Server.prototype.listen;Server.prototype.listen=function(...args){this.once('listening',()=>console.log(JSON.stringify({fixtureDiagnostic:'listening',port:this.address().port})));this.once('close',()=>console.log(JSON.stringify({fixtureDiagnostic:'closed'})));return Reflect.apply(listen,this,args);};`;
  const env={...process.env,DSH_BOT_CHROMIUM:missing};delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(observer)}`,'--test','--test-reporter=tap','--test-name-pattern=^v111 original actual response body is returned and listeners end$',import.meta.filename],{
    detached:process.platform!=='win32',env,stdio:['ignore','pipe','pipe'],
  });
  let output='',exited=false,timedOut,phase='startup',timer;
  const knownFailure=()=>output.includes('not ok 1 - v111 original actual response body is returned and listeners end')&&output.includes(missing)&&/executable doesn.*exist/i.test(output);
  const terminate=()=>{if(!exited&&child.pid)try{if(process.platform==='win32')child.kill('SIGTERM');else process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}};
  t.signal.addEventListener('abort',terminate,{once:true});
  t.after(()=>{t.signal.removeEventListener('abort',terminate);terminate();});
  child.stdout.on('data',bytes=>{
    output+=bytes;
    if(phase==='startup'&&knownFailure()){
      phase='drain';clearTimeout(timer);timer=setTimeout(()=>{timedOut='drain';terminate();},4000);
    }
  });child.stderr.on('data',()=>{});
  const outcome=await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>{timedOut='startup';terminate();},10000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',(code,signal)=>{exited=true;clearTimeout(timer);resolve({code,signal});});
  });
  assert.equal(timedOut,undefined,timedOut==='startup'?'The selected original failure must report within its startup allowance':'The reported failed fixture must drain without forced termination');
  assert.equal(output.includes('not ok 1 - v111 original actual response body is returned and listeners end'),true,'The original actual test must report its launch failure');
  assert.equal(output.includes(missing),true,'The original missing executable error must survive');assert.equal(/executable doesn.*exist/i.test(output),true,'The original executable launch error must remain');
  assert.deepEqual(outcome,{code:1,signal:null});
  assert.equal(output.includes('"fixtureDiagnostic":"closed"'),true,'The actual server must emit close before the child exits');
  const port=Number(output.match(/\{"fixtureDiagnostic":"listening","port":(\d+)\}/)?.[1]);assert.ok(port>0);
  const physical=await new Promise(resolve=>{
    const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve('listening');});socket.once('error',error=>resolve(error.code));socket.setTimeout(500,()=>{socket.destroy();resolve('timeout');});
  });
  assert.equal(physical,'ECONNREFUSED','The same real server port must no longer accept connections');
});
