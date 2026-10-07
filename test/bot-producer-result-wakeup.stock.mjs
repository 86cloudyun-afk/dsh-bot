/** Original SDK generations with keyless synthetic SSE; no remote-model qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeOf} from '@deepseek-ai/dsh-scope';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {SessionCreationDriver} from '../src/session-creation.mjs';
import {installOwnedBotProducer} from '../src/bot-producer.mjs';
import {createOwnedMainGenerationBridge} from '../src/owned-main-generation.mjs';
import {digest} from '../src/errors.mjs';
import {generationFixture,syntheticResponse,tick,observeUntil} from './work-generation-fixture.mjs';

const holdMs=900,caseOptions={timeout:8000,concurrency:false};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checkpoint=()=>{};

async function producerFixture(t,fetcher){
 const f=await generationFixture(t,fetcher);
 const intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
 const mainPort=f.host.adapter.ownedGenerationCreationPort([intent.sessionId],{
  scopeOf,role:'main',prepareGeneration:i=>f.prepareGeneration(i,'main'),isCurrent:()=>true,
 });
 const created=await new SessionCreationDriver({host:f.host,caller:f.caller,port:mainPort}).run(f.caller,intent.operationId);
 assert.equal(created.state,'created');
 let source;
 const producer=installOwnedBotProducer({ownerCtx:f.ctx,host:f.host,caller:f.caller,
  originAgent:f.ctx.agents.get(intent.sessionId),botId:f.bot.botId,botEpoch:1,authorityEpoch:1,
  cwd:f.directory,rootInstructionRef:'keyless-original-producer-result-wakeup',execution:{
   beforeExecute:async()=>{},generationControl:{
    prepareWorkGeneration:i=>f.prepareGeneration(i),
    bindMainDelegateTool:definition=>{
     source=f.host.adapter.bindOwnedMainGeneration(mainPort,created,definition);return source;
    },
   },
  },
 });
 const bridge=createOwnedMainGenerationBridge({host:f.host,ownerCtx:f.ctx,source,
  botId:f.bot.botId,botEpoch:1,authorityEpoch:1,sessionId:intent.sessionId,configVersion:f.bot.configVersion});
 const reader=f.host.openOwnedWorkSessionPort(f.caller,{botId:f.bot.botId,botEpoch:1,authorityEpoch:1});
 return {...f,producer,bridge,reader,mainSessionId:intent.sessionId};
}

async function startOriginalWork(f,task_id){
 const work=await f.producer.delegate({operationId:task_id+'/delegate',nonce:task_id+'/delegate',task_id,
  goal:'Return the original synthetic result once',completion_condition:'Route its exact known original result to main'});
 assert.equal(work.sessionCreation.state,'created');assert.equal(work.generation,1);
 await f.producer.execute({task_id:work.task_id,generation:work.generation});
 const generations=f.ledger.list('workGeneration'),deliveries=f.ledger.list('workDelivery');
 assert.equal(generations.length,1);assert.equal(deliveries.length,1);
 const original=structuredClone(generations[0]),delivery=structuredClone(deliveries[0]);
 assert.equal(original.sessionId,work.sessionId);assert.equal(original.taskId,work.taskId);
 assert.equal(original.binding.inputMessageId,delivery.message.id);
 return {work,original,delivery,inputs:structuredClone(f.ledger.list('workInput'))};
}

function assertKnownReceipt(observation){
 assert.equal(observation.local,'returned');assert.equal(observation.remote,'settled');
 assert.equal(observation.usageKnown,true);assert.equal(observation.settlementVerified,true);
 assert.equal(observation.usage.inputTokens,5);assert.equal(observation.usage.outputTokens,3);
 assert.equal(observation.usage.totalTokens,8);
}

async function originalWorkReceipt(f,started){
 await f.ctx.agents.get(started.work.sessionId).whenIdle();await tick();
 // Inspect the exact retained SDK operation; this reader cannot invoke producer routing.
 const proof=await observeUntil(async()=>{
  try{return await f.reader.collect({task_id:started.work.task_id,generation:1});}
  catch(error){if(error.code==='work_lookup_in_progress')return null;throw error;}
 },value=>value?.generationObservation.settlementVerified===true);
 assert.equal(proof.nativeRuntimeVerified,true);assertKnownReceipt(proof.generationObservation);
 assert.equal(proof.sessionId,started.work.sessionId);assert.equal(proof.generation,1);
 return proof;
}

async function persistedSession(f,sessionId){
 const handle=await f.ctx.sessionPersistence.open(sessionId,'read');
 try{assert.equal(handle.header.id,sessionId);return await handle.read();}
 finally{await handle.close();}
}

async function assertSingleOriginalResult(f,started,resultText,expectedMainGenerations){
 // Routing waits only read ledger state; no event injection, Continue, or execute replay.
 const route=await observeUntil(()=>f.ledger.list('workObservedResponse'),
  rows=>rows.length===1&&rows[0].routing==='durably-queued',2500).then(rows=>rows[0]);
 const mainRows=f.ledger.list('ownedMainGeneration');
 assert.equal(mainRows.length,expectedMainGenerations);
 const resultRows=mainRows.filter(row=>row.binding.kind==='work-result');assert.equal(resultRows.length,1);
 const mainBinding=resultRows[0].binding;
 assert.equal(route.botId,f.bot.botId);assert.equal(route.taskId,started.work.taskId);
 assert.equal(route.sessionId,started.work.sessionId);assert.equal(route.generation,1);
 assert.equal(route.originSessionId,f.mainSessionId);assert.equal(route.text,resultText);
 assert.equal(route.textDigest,digest(resultText));
 assert.equal(route.inputMessageId,started.original.binding.inputMessageId);
 assert.equal(route.resultInputMessageId,mainBinding.inputMessageId);
 assert.deepEqual(route.generationBinding,mainBinding);
 assert.deepEqual(mainBinding.parentWorkBinding,started.original.binding);
 assert.equal(mainBinding.sessionId,f.mainSessionId);assert.equal(mainBinding.generation,expectedMainGenerations);

 await f.ctx.agents.get(f.mainSessionId).whenIdle();await tick();
 const mainReceipt=await f.bridge.inspect(mainBinding,checkpoint);
 assert.deepEqual(mainReceipt.binding,mainBinding);assertKnownReceipt(mainReceipt.generationObservation);
 await observeUntil(()=>f.ledger.list('workObservedResponse')[0],
  value=>value?.mainGenerationObservation?.settlementVerified===true);

 const log=await persistedSession(f,f.mainSessionId);
 const inserted=log.events.flatMap(event=>event.type==='agent/inbox/spliced'?event.data.inserted:[])
  .filter(message=>message.id===route.resultInputMessageId);
 const consumed=log.events.filter(event=>event.type==='user/message'&&event.data.id===route.resultInputMessageId);
 assert.equal(inserted.length,1);assert.equal(consumed.length,1);
 assert.deepEqual(consumed[0].data,inserted[0]);
 assert.equal(inserted[0].source.kind,'dsh-bot-work-result');
 assert.equal(inserted[0].source.inputMessageId,started.original.binding.inputMessageId);
 assert.equal(inserted[0].source.producerId,route.producerId);
 assert.equal(inserted[0].source.task_id,started.work.task_id);
 assert.deepEqual(inserted[0].content,[{type:'text',text:`Observed work result (${started.work.task_id}): ${resultText}`}]);
 assert.equal(mainBinding.messageIdentity,digest(inserted[0]));

 const workEvents=f.ctx.sessions.get(started.work.sessionId).snapshotEvents();
 const workInputs=workEvents.filter(event=>event.type==='user/message'&&event.data.id===started.original.binding.inputMessageId);
 assert.equal(workInputs.length,1);assert.deepEqual(workInputs[0].data,started.delivery.message);
 const response=workEvents.find(event=>event.type==='assistant/message'&&event.data.message.id===route.responseMessageId);
 assert.ok(response);assert.equal(response.seq,route.responseSeq);assert.equal(response.data.turn,route.turn);
 assert.equal(response.data.message.content.map(block=>block.text).join(''),resultText);
 assert.equal(workEvents.some(event=>event.type==='turn/end'&&event.data.turn===route.turn&&event.data.reason?.kind==='completed'),true);

 // Let already queued ordinary callbacks finish, then exclude duplicate result/input admission.
 await delay(80);
 const generations=f.ledger.list('workGeneration'),deliveries=f.ledger.list('workDelivery');
 assert.equal(generations.length,1);assert.equal(deliveries.length,1);
 assert.deepEqual(generations[0].binding,started.original.binding);
 assert.deepEqual(generations[0].slotLease,started.original.slotLease);
 assert.deepEqual(deliveries[0].message,started.delivery.message);
 assertKnownReceipt(generations[0].generationObservation);
 assert.equal(generations[0].held,false);assert.equal(generations[0].state,'waiting');
 assert.deepEqual(f.ledger.list('workInput'),started.inputs);
 assert.equal(f.ledger.list('workObservedResponse').length,1);
 assert.equal(f.ledger.list('ownedMainGeneration').length,expectedMainGenerations);
 assert.equal(f.ledger.list('workContinuation').length,0);
 assert.equal(f.requests(),expectedMainGenerations+1);
}

test('original delayed work terminal wakes one durable protected main result after the initial pending window',caseOptions,async t=>{
 const resultText='Known original delayed work result',workResponse=Promise.withResolvers();let f,calls=0;
 // Register gate release before the fixture's original cleanup so no request stays pending.
 t.after(()=>{workResponse.resolve(syntheticResponse({text:resultText}));f?.producer.dispose();f?.reader.dispose();});
 f=await producerFixture(t,()=>++calls===1?workResponse.promise:syntheticResponse({text:'Known main receipt for delayed work'}));
 const started=await startOriginalWork(f,'delayed-original-work');await f.waitRequest(1);
 await delay(holdMs);
 const pending=f.producer.query({task_ids:[started.work.task_id]}).work[0];
 assert.equal(pending.generationObservation.local,'pending');assert.equal(pending.nativeRuntimeVerified,false);
 assert.equal(f.ledger.list('workObservedResponse').length,0);assert.equal(f.requests(),1);
 workResponse.resolve(syntheticResponse({text:resultText}));
 await originalWorkReceipt(f,started);
 await assertSingleOriginalResult(f,started,resultText,1);
});

test('original main terminal wakes its already known work result once after a prolonged protected main request',caseOptions,async t=>{
 const resultText='Known original work result while main is busy',mainResponse=Promise.withResolvers();let f,calls=0;
 t.after(()=>{mainResponse.resolve(syntheticResponse({text:'Known original contact receipt'}));f?.producer.dispose();f?.reader.dispose();});
 f=await producerFixture(t,()=>{
  const call=++calls;if(call===1)return mainResponse.promise;
  return syntheticResponse({text:call===2?resultText:'Known main receipt for its original work result'});
 });
 const contactInput=createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Original protected main contact before work'}]});
 const admission=await f.bridge.admit(checkpoint);let contact;
 try{contact=admission.start({kind:'contact',taskId:f.bot.botId,taskEpoch:1,taskRevision:1,
  operationId:'busy-original-contact',nonce:'busy-original-contact',message:contactInput},checkpoint);}
 finally{admission.release();}
 const originalContact=structuredClone(contact.binding);await f.waitRequest(1);
 const started=await startOriginalWork(f,'busy-main-original-work');await f.waitRequest(2);
 await originalWorkReceipt(f,started);
 // Hold main past the pending-routing window after the work has genuinely returned.
 await delay(2500);
 assert.equal(f.ledger.list('workObservedResponse').length,0);assert.equal(f.requests(),2);
 const before=f.ledger.list('ownedMainGeneration');assert.equal(before.length,1);
 assert.deepEqual(before[0].binding,originalContact);
 const pendingMain=await f.bridge.inspect(originalContact,checkpoint);
 assert.equal(pendingMain.generationObservation.local,'pending');
 assert.equal(pendingMain.generationObservation.settlementVerified,false);
 mainResponse.resolve(syntheticResponse({text:'Known original contact receipt'}));
 await f.ctx.agents.get(f.mainSessionId).whenIdle();await tick();
 const knownContact=await f.bridge.inspect(originalContact,checkpoint);
 assert.deepEqual(knownContact.binding,originalContact);assertKnownReceipt(knownContact.generationObservation);
 await assertSingleOriginalResult(f,started,resultText,2);
 const contacts=f.ledger.list('ownedMainGeneration').filter(row=>row.binding.kind==='contact');
 assert.equal(contacts.length,1);assert.deepEqual(contacts[0].binding,originalContact);
 const log=await persistedSession(f,f.mainSessionId);
 const inputs=log.events.filter(event=>event.type==='user/message'&&event.data.id===contactInput.id);
 assert.equal(inputs.length,1);assert.deepEqual(inputs[0].data,contactInput);
});
