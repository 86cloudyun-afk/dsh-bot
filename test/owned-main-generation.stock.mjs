/** Actual SDK main loop with keyless synthetic SSE; no real model acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeOf} from '@deepseek-ai/dsh-scope';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {SessionCreationDriver} from '../src/session-creation.mjs';
import {createOwnedMainGenerationBridge} from '../src/owned-main-generation.mjs';
import {generationFixture,syntheticResponse,tick} from './work-generation-fixture.mjs';

async function main(t,fetcher){
 const f=await generationFixture(t,fetcher),i=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
 const port=f.host.adapter.ownedGenerationCreationPort([i.sessionId],{scopeOf,role:'main',prepareGeneration:i=>f.prepareGeneration(i,'main'),isCurrent:()=>true});
 const created=await new SessionCreationDriver({host:f.host,caller:f.caller,port}).run(f.caller,i.operationId);assert.equal(created.state,'created');
 const agent=f.ctx.agents.get(i.sessionId),definition=defineTool({name:'dsh_bot_delegate',description:'Synthetic harmless main scope',parameters:{},output:{schema:{type:'object',additionalProperties:true},render:()=>[]},async execute(){return{};}});
 const unregister=agent.ctx.tools.register(definition);t.after(()=>unregister());
 const source=f.host.adapter.bindOwnedMainGeneration(port,created,definition),bridge=createOwnedMainGenerationBridge({host:f.host,ownerCtx:f.ctx,source,botId:f.bot.botId,botEpoch:1,authorityEpoch:1,sessionId:i.sessionId,configVersion:f.bot.configVersion});
 const send=async(operationId='main-operation')=>{const admission=await bridge.admit(()=>{});try{const message=createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Synthetic main input'}]});return admission.start({kind:'contact',taskId:operationId,taskEpoch:1,taskRevision:1,operationId,nonce:operationId,message},()=>{});}finally{admission.release();}};
 return{...f,source,bridge,send,agent};
}

test('actual SDK synthetic main settles exact input and shares sequential admission across private consumers',async t=>{
 const f=await main(t),first=await f.send();let result=first;
 for(let n=0;n<30&&!result.generationObservation.settlementVerified;n++){await tick();result=await f.bridge.inspect(first.binding,()=>{});}
 assert.equal(result.generationObservation.remote,'settled');assert.equal(result.generationObservation.usageKnown,true);assert.equal(result.generationObservation.settlementVerified,true);
 const second=await f.send('main-operation-two');assert.equal(second.binding.generation,2);assert.equal(second.binding.sessionId,first.binding.sessionId);assert.notEqual(second.binding.inputMessageId,first.binding.inputMessageId);
 assert.deepEqual(await f.bridge.inspect(first.binding,()=>{}),result);assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});

test('actual SDK synthetic main missing finish keeps UNKNOWN and blocks allocation of next original input',async t=>{
 const f=await main(t,()=>syntheticResponse({finish:false})),first=await f.send();for(let n=0;n<30&&f.agent.status!=='idle';n++)await tick();
 const result=await f.bridge.inspect(first.binding,()=>{});assert.equal(result.generationObservation.local,'returned');assert.equal(result.generationObservation.remote,'UNKNOWN');
 const before=f.ledger.list('ownedMainGeneration');await assert.rejects(()=>f.send('main-operation-two'),e=>e.code==='main_generation_unsettled');assert.deepEqual(f.ledger.list('ownedMainGeneration'),before);assert.equal(f.requests(),1);
});

test('actual SDK synthetic main cancel follows durable original fence and never declares remote stop',async t=>{
 let f,aborted=false;f=await main(t,(_url,init)=>new Promise((_,reject)=>{init.signal.addEventListener('abort',()=>{assert.equal(f.ledger.list('ownedMainGeneration')[0].fence.operationId,'main-stop');aborted=true;reject(new DOMException('Synthetic original cancellation','AbortError'));},{once:true});}));
 const first=await f.send();await f.waitRequest();
 const result=await f.bridge.cancel(first.binding,{operationId:'main-stop',nonce:'main-stop',reason:'terminate'},()=>{});
 assert.equal(aborted,true);assert.equal(result.generationObservation.local,'returned');assert.equal(result.generationObservation.remote,'UNKNOWN');assert.equal(result.generationObservation.settlementVerified,false);
 const before=f.requests();assert.deepEqual(await f.bridge.cancel(first.binding,{operationId:'main-stop',nonce:'main-stop',reason:'terminate'},()=>{}),result);assert.equal(f.requests(),before);
});

test('synthetic copied main source cannot allocate native generation or run its structural methods',async t=>{
 const f=await main(t);let invoked=0;const copy={start(){invoked++;},inspect(){invoked++;},cancel(){invoked++;}};
 const bridge=createOwnedMainGenerationBridge({host:f.host,ownerCtx:f.ctx,source:copy,botId:f.bot.botId,botEpoch:1,authorityEpoch:1,sessionId:f.agent.id,configVersion:f.bot.configVersion});
 await assert.rejects(()=>bridge.admit(()=>{}),e=>e.code==='unsupported_owned_generation_source');assert.equal(invoked,0);assert.equal(f.ledger.list('ownedMainGeneration').length,0);assert.equal(f.requests(),0);
});
