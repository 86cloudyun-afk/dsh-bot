/** Actual SDK loop using synthetic SSE. No remote/native-cold acceptance claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeOf} from '@deepseek-ai/dsh-scope';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {SessionCreationDriver} from '../src/session-creation.mjs';
import {generationFixture,envelope,tick,syntheticResponse} from './work-generation-fixture.mjs';

async function work(t,fetcher) {
 const f=await generationFixture(t,fetcher);
 const producer={execution:true,provenance:{producerId:'synthetic-owned-producer',ingress:'owner',originSessionId:'synthetic-main'},isCurrent:()=>true,
  createMessage:(binding,provenance,text)=>createUserMessage({content:[{type:'text',text}],source:{kind:'dsh-bot',...provenance,...binding}}),
  send:async()=>{throw Error('RAW_TRANSPORT_MUST_NOT_SEND_NATIVE_GENERATION');},inspect:async()=>false};
 const port=f.host.openOwnedWorkSessionPort(f.caller,{botId:f.bot.botId,botEpoch:1,authorityEpoch:1,producer,creation:{cwd:f.directory,portFor:i=>f.host.adapter.ownedGenerationCreationPort([i.sessionId],{scopeOf,role:'work',prepareGeneration:f.prepareGeneration,isCurrent:()=>true})}});t.after(()=>port.dispose());
 const query=()=>port.query({}).work[0];
 const call=(method,command,payload)=>port[method](envelope(command,payload,query()?.revision??null,{nativeOwner:1,bot:1,...query()?{task:1}:{}}),payload);
 call('delegate','delegateWorkSession',{task_id:'work',goal:'Use synthetic source',completion_condition:'Settle only original branded generation'});
 const created=await call('createSession','prepareWorkSessionCreation',{task_id:'work',generation:1});assert.equal(created.sessionCreation.state,'created');assert.equal(created.sessionCreation.proofKind,'stock-session-durable');
 return {...f,port,query,call};
}

test('actual SDK synthetic loop reserves before sole native source send and releases exact original receipt',async t=>{
 let f;f=await work(t,()=>{assert.equal(f.port.query({}).held,1);return syntheticResponse();});
 const started=await f.call('executeMessage','prepareWorkSessionExecution',{task_id:'work',generation:1});assert.equal(started.held,true);
 let result=started;for(let n=0;n<30&&result.held;n++){await tick();result=await f.port.collect({task_id:'work',generation:1});}
 assert.equal(result.state,'waiting');assert.equal(result.held,false);assert.equal(result.generationObservation.local,'returned');assert.equal(result.generationObservation.remote,'settled');assert.equal(result.generationObservation.usageKnown,true);assert.equal(result.generationObservation.settlementVerified,true);assert.equal(f.requests(),1);
 const before=structuredClone(result);assert.deepEqual(await f.port.collect({task_id:'work',generation:1}),before);assert.equal(f.requests(),1);assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});

for(const options of [{finish:false},{usage:false}])test(`actual SDK synthetic local return keeps original UNKNOWN slot for ${JSON.stringify(options)}`,async t=>{
 const f=await work(t,()=>syntheticResponse(options));await f.call('executeMessage','prepareWorkSessionExecution',{task_id:'work',generation:1});
 let result;for(let n=0;n<30;n++){await tick();result=await f.port.collect({task_id:'work',generation:1});if(result.generationObservation.local==='returned')break;}
 assert.equal(result.generationObservation.local,'returned');assert.equal(result.held,true);assert.equal(result.generationObservation.remote,'UNKNOWN');assert.equal(result.generationObservation.settlementVerified,false);assert.equal(f.requests(),1);
});

test('actual SDK synthetic stop observes durable product fence before original abort and keeps remote UNKNOWN',async t=>{
 let f,abortObserved=false;f=await work(t,(_url,init)=>new Promise((_,reject)=>{
  const aborted=()=>{assert.equal(f.query().fence.reason,'terminate');abortObserved=true;reject(new DOMException('Synthetic original cancellation','AbortError'));};
  if(init.signal.aborted)aborted();else init.signal.addEventListener('abort',aborted,{once:true});
 }));
 await f.call('executeMessage','prepareWorkSessionExecution',{task_id:'work',generation:1});for(let n=0;n<30&&!f.requests();n++)await tick();
 const stopped=await f.call('stop','fenceWorkSession',{task_id:'work',generation:1,reason:'terminate'});
 assert.equal(abortObserved,true);assert.equal(stopped.held,true);assert.equal(stopped.generationObservation.local,'returned');assert.equal(stopped.generationObservation.remote,'UNKNOWN');assert.equal(stopped.generationObservation.settlementVerified,false);assert.equal(f.requests(),1);
});

test('actual SDK synthetic late original receipt cannot release resumed generation or change its slot lease',async t=>{
 let request=0;const f=await work(t,()=>++request===1?syntheticResponse():new Promise(()=>{}));
 await f.call('executeMessage','prepareWorkSessionExecution',{task_id:'work',generation:1});let first;for(let n=0;n<30;n++){await tick();first=await f.port.collect({task_id:'work',generation:1});if(!first.held)break;}assert.equal(first.state,'waiting');
 f.call('resume','resumeWorkSession',{task_id:'work',generation:1});await f.call('executeMessage','prepareWorkSessionExecution',{task_id:'work',generation:2});
 const newer=f.query();assert.equal(newer.held,true);assert.equal(newer.generation,2);assert.equal(f.port.query({}).held,1);
 for(let n=0;n<2;n++)assert.deepEqual(await f.port.collect({task_id:'work',generation:1}),newer);
 assert.equal(f.port.query({}).held,1);assert.deepEqual(f.query().slotLease,newer.slotLease);
});

test('actual SDK protected preparation may await private journal work before native creation',async t=>{
 const f=await generationFixture(t),i={operationId:'async-private-prepare',sessionId:`session-${crypto.randomUUID()}`,cwd:f.directory,agentPreset:'synthetic/empty',kind:'execution',botId:f.bot.botId,botEpoch:1,configVersion:f.bot.configVersion,authorityEpoch:1};
 let awaited=false;const port=f.host.adapter.ownedGenerationCreationPort([i.sessionId],{scopeOf,role:'work',isCurrent:()=>true,prepareGeneration:async intent=>{await tick();assert.equal(f.ctx.agents.get(i.sessionId),undefined);awaited=true;return f.prepareGeneration(intent);}});
 assert.equal((await port.createOwnedSession(i)).sessionId,i.sessionId);assert.equal((await port.inspectOwnedCreation(i)).blank,true);assert.equal(awaited,true);assert.equal(f.requests(),0);
});

test('actual SDK async private preparation checks owner again before first native effect',async t=>{
 const f=await generationFixture(t),i={operationId:'async-private-owner',sessionId:`session-${crypto.randomUUID()}`,cwd:f.directory,agentPreset:'synthetic/empty',kind:'execution',botId:f.bot.botId,botEpoch:1,configVersion:f.bot.configVersion,authorityEpoch:1};
 let current=true;const port=f.host.adapter.ownedGenerationCreationPort([i.sessionId],{scopeOf,role:'work',isCurrent:()=>current,prepareGeneration:async intent=>{await tick();const prepared=f.prepareGeneration(intent);current=false;return prepared;}});
 await assert.rejects(()=>port.createOwnedSession(i),e=>e.code==='host_disconnected');assert.equal(f.ctx.agents.get(i.sessionId),undefined);assert.equal(f.ctx.sessions.get(i.sessionId),undefined);assert.equal(f.requests(),0);
});

test('actual SDK protected main creation preserves original contact intent with absent kind',async t=>{
 const f=await generationFixture(t),intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);assert.equal(intent.kind,undefined);
 const port=f.host.adapter.ownedGenerationCreationPort([intent.sessionId],{scopeOf,role:'main',isCurrent:()=>true,prepareGeneration:i=>f.prepareGeneration(i,'main')});
 const result=await new SessionCreationDriver({host:f.host,caller:f.caller,port}).run(f.caller,intent.operationId);assert.equal(result.state,'created');assert.equal(result.proof.blank,true);assert.equal(f.host.object('bot',f.bot.botId).contactSessionId,intent.sessionId);assert.equal(f.requests(),0);
});
