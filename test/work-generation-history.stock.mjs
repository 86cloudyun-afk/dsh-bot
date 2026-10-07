/** Actual known-journal SDK restart with keyless synthetic SSE. No remote-model evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {scopeOf} from '@deepseek-ai/dsh-scope';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {Ledger} from '../src/ledger.mjs';
import {canonical} from '../src/errors.mjs';
import {SessionCreationDriver} from '../src/session-creation.mjs';
import {createOwnedMainGenerationBridge} from '../src/owned-main-generation.mjs';
import {generationFixture,syntheticResponse,preset,route,observeUntil,envelope} from './work-generation-fixture.mjs';

const tool=()=>defineTool({name:'dsh_bot_delegate',description:'Synthetic known-history exact main scope',parameters:{},output:{schema:{type:'object',additionalProperties:true},render:()=>[]},async execute(){return{};}});
async function journalPort(f,intent,role,create,definition){
 assert.equal(typeof f.Native.openOwnedGenerationJournal,'function','M1_FROZEN_GENERATION_SDK_REQUIRED');
 const journal=await f.Native.openOwnedGenerationJournal({ownerCtx:f.ctx,directory:join(f.directory,'journals',intent.sessionId),create,sessionId:intent.sessionId,role,route,session:{cwd:f.directory,agentPreset:preset}});
 const port=f.host.adapter.ownedGenerationCreationPort([intent.sessionId],{scopeOf,role,isCurrent:()=>true,prepareGeneration:()=>({route,prepared:f.Native.prepareOwnedGenerationSource({ownerCtx:f.ctx,providerFactory:f.ctx.deepseekProtectedProviders.lookup(route.provider),sessionId:intent.sessionId,role,route,journal,...definition?{delegateTool:definition}:{},isCurrent:()=>true})})});
 return{journal,port};
}
async function shared(t,fetcher){const directory=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'generation-history-')),ledger=new Ledger(join(directory,'product.sqlite'));return{...await generationFixture(t,fetcher,{directory,ledger}),closeLedger:()=>ledger.close()};}
function bridge(f,source,sessionId){return createOwnedMainGenerationBridge({host:f.host,ownerCtx:f.ctx,source,botId:f.bot.botId,botEpoch:1,authorityEpoch:1,sessionId,configVersion:f.bot.configVersion});}
async function send(bridge,operationId){const admission=await bridge.admit(()=>{});try{return admission.start({kind:'contact',taskId:operationId,taskEpoch:1,taskRevision:1,operationId,nonce:operationId,message:createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Synthetic same-session input'}]})},()=>{});}finally{admission.release();}}
const settle=(bridge,binding)=>observeUntil(()=>bridge.inspect(binding,()=>{}),value=>value.generationObservation.local==='returned');

test('actual SDK known main restores original branded receipt without replay then continues original session',async t=>{
 const f=await shared(t),preparedIntent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision),first=await journalPort(f,preparedIntent,'main',true);
 const intent=await new SessionCreationDriver({host:f.host,caller:f.caller,port:first.port}).run(f.caller,preparedIntent.operationId);assert.equal(intent.state,'created');
 const firstTool=tool(),firstAgent=f.ctx.agents.get(intent.sessionId);firstAgent.ctx.tools.register(firstTool);const firstSource=f.host.adapter.bindOwnedMainGeneration(first.port,intent,firstTool),oldBridge=bridge(f,firstSource,intent.sessionId),original=await send(oldBridge,'history-main-one'),settled=await settle(oldBridge,original.binding);
 assert.equal(settled.generationObservation.settlementVerified,true);assert.equal(f.requests(),1);await f.ctx.fiber.dispose();await first.journal.close();
 const next=await generationFixture(t,undefined,{directory:f.directory,ledger:f.ledger,botId:f.bot.botId});t.after(f.closeLedger);
 const nextTool=tool(),resumed=await journalPort(next,intent,'main',false,nextTool);t.after(()=>resumed.journal.close());
 await resumed.port.resumeOwnedSession(intent,{delegateTool:nextTool});const restoredProof=await resumed.port.inspectOwnedCreation(intent);assert.equal(restoredProof.blank,false);
 const nextAgent=next.ctx.agents.get(intent.sessionId);nextAgent.ctx.tools.register(nextTool);const nextSource=next.host.adapter.bindOwnedMainGeneration(resumed.port,intent,nextTool),nextBridge=bridge(next,nextSource,intent.sessionId);
 assert.equal(typeof nextBridge.restore,'function');await assert.rejects(()=>nextBridge.restore({...original.binding,nonce:'changed-original-nonce'},()=>{}),e=>e.code==='main_generation_binding_conflict');const restored=await nextBridge.inspect(original.binding,()=>{});assert.deepEqual(restored.binding,original.binding);assert.equal(restored.generationObservation.settlementVerified,true);assert.equal((await nextBridge.restore(original.binding,()=>{})).generationObservation.settlementVerified,true);assert.equal(next.requests(),0);
 const continued=await send(nextBridge,'history-main-two');assert.equal(continued.binding.generation,2);assert.equal(continued.binding.sessionId,intent.sessionId);assert.notEqual(continued.binding.inputMessageId,original.binding.inputMessageId);assert.equal((await settle(nextBridge,continued.binding)).generationObservation.settlementVerified,true);assert.equal(next.requests(),1);
 assert.deepEqual((await nextBridge.inspect(original.binding,()=>{})).binding,original.binding);
});

test('actual SDK UNKNOWN original journal rejects main resume before native activation or replay',async t=>{
 const f=await shared(t,()=>syntheticResponse({finish:false})),preparedIntent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision),first=await journalPort(f,preparedIntent,'main',true);
 const intent=await new SessionCreationDriver({host:f.host,caller:f.caller,port:first.port}).run(f.caller,preparedIntent.operationId),definition=tool(),agent=f.ctx.agents.get(intent.sessionId);agent.ctx.tools.register(definition);const originalBridge=bridge(f,f.host.adapter.bindOwnedMainGeneration(first.port,intent,definition),intent.sessionId),original=await send(originalBridge,'history-unknown-one');
 assert.equal((await settle(originalBridge,original.binding)).generationObservation.remote,'UNKNOWN');const rowKey=canonical([f.bot.botId,intent.sessionId,original.binding.generation]),persisted=f.ledger.get('ownedMainGeneration',rowKey);f.ledger.put('ownedMainGeneration',rowKey,{...persisted,state:'settled',generationObservation:{local:'returned',remote:'settled',usageKnown:true,usage:{inputTokens:5,outputTokens:3,totalTokens:8},settlementVerified:true}});await f.ctx.fiber.dispose();await first.journal.close();
 const next=await generationFixture(t,undefined,{directory:f.directory,ledger:f.ledger,botId:f.bot.botId});t.after(f.closeLedger);
 await assert.rejects(()=>journalPort(next,intent,'main',false,tool()));assert.equal(next.ctx.agents.get(intent.sessionId),undefined);assert.equal(next.ctx.sessions.get(intent.sessionId),undefined);assert.equal(next.requests(),0);assert.equal(next.ledger.list('ownedMainGenerationCounter')[0].generation,1);
});

function workPort(f,create){const journals=[],port=f.host.openOwnedWorkSessionPort(f.caller,{botId:f.bot.botId,botEpoch:1,authorityEpoch:1,producer:{execution:true,requireOwnedGeneration:true,provenance:{producerId:'synthetic-known-work',ingress:'owner',originSessionId:'synthetic-main'},isCurrent:()=>true,createMessage:(binding,provenance,text)=>createUserMessage({source:{kind:'dsh-bot',...provenance,...binding},content:[{type:'text',text}]}),send:async()=>{throw Error('RAW_RESTORE_TRANSPORT_DENIED');},inspect:async()=>false},creation:{cwd:f.directory,portFor:i=>f.host.adapter.ownedGenerationCreationPort([i.sessionId],{scopeOf,role:'work',isCurrent:()=>true,prepareGeneration:async()=>{const journal=await f.Native.openOwnedGenerationJournal({ownerCtx:f.ctx,directory:join(f.directory,'journals',i.sessionId),create,sessionId:i.sessionId,role:'work',route,session:{cwd:i.cwd,agentPreset:i.agentPreset}});journals.push(journal);return{route,prepared:f.Native.prepareOwnedGenerationSource({ownerCtx:f.ctx,providerFactory:f.ctx.deepseekProtectedProviders.lookup(route.provider),sessionId:i.sessionId,role:'work',route,journal,isCurrent:()=>true})};}})}});
 const query=()=>port.query({task_ids:['history-work']}).work[0],call=(method,command,payload)=>port[method](envelope(command,payload,method==='delegate'?null:query().revision,{nativeOwner:1,bot:1,...method==='delegate'?{}:{task:1}}),payload);
 return{port,query,call,close:async()=>{port.dispose();for(const journal of journals)await journal.close();}};
}

test('actual SDK known work restores exact original lease then executes new input in the same session',async t=>{
 const f=await shared(t),first=workPort(f,true);first.call('delegate','delegateWorkSession',{task_id:'history-work',goal:'Synthetic known history work',completion_condition:'Keep original IDs and native evidence'});await first.call('createSession','prepareWorkSessionCreation',{task_id:'history-work',generation:1});await first.call('executeMessage','prepareWorkSessionExecution',{task_id:'history-work',generation:1});
 const settled=await observeUntil(()=>first.port.collect({task_id:'history-work',generation:1}),value=>!value.held);assert.equal(settled.state,'waiting');const known=f.ledger.list('workGeneration')[0],originalBinding=known.binding;assert.equal(f.requests(),1);await first.close();await f.ctx.fiber.dispose();f.ledger.put('workGeneration',canonical([known.botId,known.taskId,known.generation]),{...known,state:'unknown',held:true,generationObservation:{...known.generationObservation,usage:{inputTokens:999,outputTokens:999,totalTokens:1998}}});
 const next=await generationFixture(t,undefined,{directory:f.directory,ledger:f.ledger,botId:f.bot.botId});t.after(f.closeLedger);const restored=workPort(next,false);t.after(()=>restored.close());assert.equal(typeof restored.port.restoreSession,'function');assert.equal(restored.query().nativeRuntimeVerified,false);assert.equal(restored.query().generationObservation.settlementVerified,false);
 const historical=await restored.port.restoreSession({task_id:'history-work',generation:1});assert.equal(historical.sessionId,settled.sessionId);assert.equal(historical.held,false);assert.equal(historical.generationObservation.settlementVerified,true);assert.equal(historical.generationObservation.usage.totalTokens,8);assert.equal(next.requests(),0);assert.deepEqual(next.ledger.list('workGeneration')[0].binding,originalBinding);assert.equal(next.host.object('task',historical.taskId).responsibility,'open');
 restored.call('resume','resumeWorkSession',{task_id:'history-work',generation:1});await restored.call('executeMessage','prepareWorkSessionExecution',{task_id:'history-work',generation:2});const continued=await observeUntil(()=>restored.port.collect({task_id:'history-work',generation:2}),value=>!value.held);assert.equal(continued.sessionId,settled.sessionId);assert.equal(continued.generation,2);assert.notEqual(continued.delivery.messageId,settled.delivery.messageId);assert.equal(next.requests(),1);assert.deepEqual(next.ledger.list('workGeneration')[0].binding,originalBinding);
});
