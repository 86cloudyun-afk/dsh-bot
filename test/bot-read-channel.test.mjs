/** Offline product tests. Fake host registration and React hooks; no authenticated Host or DOM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { apply } from '../src/plugin.mjs';
import { fixture, createBot, createTask, human } from './helpers.mjs';

function hostFixture(source) {
 const cleanups=[];let handler,provided;
 const ctx={
  get:name=>name==='dshBotReadSource'?source:undefined,
  provide(_name,value){provided=value;return()=>{provided=undefined;};},
  effect(fn){const cleanup=fn();cleanups.push(cleanup);return cleanup;},
  connection:{rpc:{handle(channel,fn){assert.equal(channel,'/dsh-bot');assert.equal(handler,undefined);handler=fn;const cleanup=()=>{handler=undefined;};cleanups.push(cleanup);return cleanup;}}},
 };
 apply(ctx);
 return {handler:()=>handler,service:()=>provided,dispose:async()=>{for(const fn of cleanups.reverse())await fn?.();}};
}
const call=(f,endpoint='snapshot',payload={},signal=new AbortController().signal,peer={})=>f.handler()(endpoint,payload,signal,peer);
test('the public read channel defaults to not_configured and rejects actor/command payloads',async()=>{
 const f=hostFixture();try{
  assert.deepEqual(await call(f),{ok:true,value:{version:1,status:'not_configured',bot:null,task:null}});
  for(const payload of [null,[],{actor:{kind:'human',id:'synthetic'}},{command:'execute'},Object.create({actor:'inherited'})]){
   assert.equal((await call(f,'snapshot',payload)).error.code,'dsh-bot/invalid_payload');
  }
  assert.equal((await call(f,'execute')).error.code,'dsh-bot/unsupported_endpoint');
  assert.throws(()=>f.service().execute(),{code:'unsupported_host_identity'});
 }finally{await f.dispose();}
 assert.equal(f.handler(),undefined);assert.equal(f.service(),undefined);
});
test('authorized-source fixture receives the peer unchanged and reuses only Bot/task snapshot fields',async()=>{
 const peer={id:'synthetic-peer'},signal=new AbortController().signal;
 const snapshot={bot:[{botId:'b',name:'Example',lifecycle:'active',readiness:'registered',epoch:1,revision:1,ownerHumanId:'PRIVATE',configVersion:'PRIVATE'}],
  task:[{taskId:'t',ownerBotId:'b',title:'Example task',responsibility:'blocked',epoch:2,revision:3,stop:{state:'unsupported',targets:['PRIVATE']},scope:{namespace:'PRIVATE'},acceptance:'PRIVATE'}],config:[{secret:'PRIVATE'}],message:[{content:'PRIVATE'}]};
 const f=hostFixture({readForPeer:async(actualPeer,actualSignal)=>{assert.equal(actualPeer,peer);assert.notEqual(actualSignal,signal);return {status:'ready',snapshot};}});
 try{
  const result=await call(f,'snapshot',{},signal,peer);
  assert.deepEqual(result,{ok:true,value:{version:1,status:'ready',bot:[{botId:'b',name:'Example',lifecycle:'active',readiness:'registered',epoch:1,revision:1}],task:[{taskId:'t',ownerBotId:'b',title:'Example task',responsibility:'blocked',epoch:2,revision:3,stop:{state:'unsupported'}}]}});
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.equal(snapshot.task[0].scope.namespace,'PRIVATE');
 }finally{await f.dispose();}
});
test('projection consumes the actual existing Host Bot/task read model in a synthetic owned ledger',async()=>{
 const owned=fixture(),bot=createBot(owned),task=createTask(owned,bot);
 // The test's explicit local human fixture is not a browser identity bridge.
 const f=hostFixture({readForPeer:async()=>({status:'ready',snapshot:owned.host.snapshot(human)})});
 try{
  const result=(await call(f)).value;
  assert.equal(result.bot[0].botId,bot.botId);assert.equal(result.bot[0].readiness,bot.readiness);
  assert.equal(result.task[0].taskId,task.taskId);assert.equal(result.task[0].responsibility,task.responsibility);
  assert.equal(result.task[0].stop.state,task.stop.state);assert.equal(result.task[0].title,task.title);
  assert.equal(result.task[0].acceptance,undefined);assert.equal(result.bot[0].ownerHumanId,undefined);
 }finally{await f.dispose();owned.ledger.close();}
});
test('empty authorized lists, denial, unavailable source and failure remain distinct',async()=>{
 for(const [source,status] of [
  [{readForPeer:async()=>({status:'ready',snapshot:{bot:[],task:[]}})},'ready'],
  [{readForPeer:async()=>({status:'access_denied',snapshot:{bot:[{name:'PRIVATE'}]}})},'access_denied'],
  [{readForPeer:async()=>({status:'not_configured'})},'not_configured'],
  [{readForPeer:async()=>{throw Error('PRIVATE');}},'read_failed'],
  [{readForPeer:async()=>({status:'ready',snapshot:{bot:[]}})},'read_failed'],
 ]){
  const f=hostFixture(source);try{const result=await call(f);assert.equal(result.value.status,status);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.deepEqual(result.value.bot,status==='ready'?[]:null);}finally{await f.dispose();}
 }
});
test('disposal cancels an in-flight source and stale completion cannot return rows',async()=>{
 let finish,sourceSignal;
 const f=hostFixture({readForPeer:(_peer,signal)=>{sourceSignal=signal;return new Promise(resolve=>{finish=resolve;});}});
 const pending=call(f);await Promise.resolve();await f.dispose();
 assert.equal(sourceSignal.aborted,true);assert.equal((await pending).error.code,'dsh-bot/cancelled');
 finish({status:'ready',snapshot:{bot:[],task:[]}});
 const next=hostFixture();assert.equal((await call(next)).value.status,'not_configured');await next.dispose();
});
test('a read cancelled before source invocation never calls the source',async()=>{
 let calls=0;const f=hostFixture({readForPeer:async()=>{calls++;return {status:'ready',snapshot:{bot:[],task:[]}};}});
 const controller=new AbortController(),pending=call(f,'snapshot',{},controller.signal);controller.abort();
 assert.equal((await pending).error.code,'dsh-bot/cancelled');assert.equal(calls,0);await f.dispose();
});

let clientRegistration;
const previousWindow=globalThis.window;
globalThis.window={__ModuleLoader__:{load:value=>{clientRegistration=value;}}};
try{await import(pathToFileURL(new URL('../src/client/client.js',import.meta.url).pathname).href);}finally{globalThis.window=previousWindow;}
function clientFixture() {
 let cursor=0,pendingEffects=[],states=[],effects=[],cleanups=[],currentState='connected',generation={id:1},readCount=0;
 let response=Promise.resolve({ok:true,value:{version:1,status:'not_configured',bot:null,task:null}});
 const calls=[],entries=[];
 const react={createElement:(type,props,...children)=>({type,props:props??{},children}),
  useState(initial){const i=cursor++;states[i]??=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
  useRef(initial){const i=cursor++;states[i]??={current:initial};return states[i];},
  useEffect(fn,deps){const i=cursor++,prior=effects[i];if(!prior||deps.some((v,j)=>!Object.is(v,prior.deps[j]))){pendingEffects.push(()=>{prior?.cleanup?.();effects[i]={deps,cleanup:fn()};});}},
 };
 const plugin=clientRegistration.factory(specifier=>{assert.equal(specifier,'react');return react;});
 const ctx={effect(fn){const cleanup=fn();cleanups.push(cleanup);return cleanup;},
  locale:{register:()=>()=>{},bind:()=>key=>key},
  slots:{inject(_name,fn){return ctx.effect(fn);},register(options,component){const entry={options,component};entries.push(entry);return()=>entries.splice(entries.indexOf(entry),1);}},
  connection:{state:{},generation:{},rpc:{call(...args){readCount++;calls.push(args);return response;}}},
 };
 plugin.apply(ctx);
 const entry=entries.find(e=>e.options.name==='main'),props=entry.options.inject();
 return {ctx,calls,entries,readCount:()=>readCount,
  setState:value=>{currentState=value;},setGeneration:value=>{generation=value;},setResponse:value=>{response=value;},
  render(){cursor=0;const tree=entry.component({t:key=>key,...props,useConnection:select=>select(currentState),useGeneration:select=>select(generation)});for(const fn of pendingEffects.splice(0))fn();return tree;},
  unmount(){for(const effect of effects)effect?.cleanup?.();effects=[];},
  dispose:async()=>{for(const fn of cleanups.reverse())await fn?.();},
 };
}
const texts=tree=>tree?.children?.flat(Infinity).map(child=>typeof child==='object'?texts(child):String(child??'')).join(' ')??'';
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
test('actual client reads only the official channel and displays not_configured, empty, denied and failure',async()=>{
 const f=clientFixture();try{
  assert.equal(f.readCount(),0);f.render();await settle();assert.match(texts(f.render()),/not_configured/);
  assert.equal(f.readCount(),1);assert.deepEqual(f.calls[0].slice(0,3),['/dsh-bot','snapshot',{}]);assert.ok(f.calls[0][3] instanceof AbortSignal);
  for(const [response,label] of [
   [{ok:true,value:{version:1,status:'ready',bot:[],task:[]}},'empty'],
   [{ok:true,value:{version:1,status:'access_denied',bot:null,task:null}},'access_denied'],
   [{ok:false,error:{code:'synthetic-failure',message:'PRIVATE'}},'read_failed'],
   [{ok:true,value:{version:1,status:'ready',bot:'invalid',task:[]}},'read_failed'],
  ]){f.setResponse(Promise.resolve(response));f.setGeneration({id:f.readCount()+1});f.render();await settle();const tree=f.render();assert.match(texts(tree),new RegExp(label));assert.equal(texts(tree).includes('PRIVATE'),false);}
 }finally{f.unmount();await f.dispose();}
});
test('actual client cancels on loss and disposal; an old generation cannot restore private rows',async()=>{
 const f=clientFixture();let finish;
 try{
  f.setResponse(new Promise(resolve=>{finish=resolve;}));f.render();const signal=f.calls[0][3];
  f.setState('disconnected');assert.doesNotMatch(texts(f.render()),/PRIVATE/);assert.equal(signal.aborted,true);
  finish({ok:true,value:{version:1,status:'ready',bot:[{botId:'b',name:'PRIVATE'}],task:[]}});await settle();assert.doesNotMatch(texts(f.render()),/PRIVATE/);
  f.setState('connected');f.setResponse(new Promise(()=>{}));f.setGeneration({id:2});f.render();const next=f.calls.at(-1)[3];await f.dispose();assert.equal(next.aborted,true);assert.equal(f.entries.length,0);
 }finally{f.unmount();}
});
