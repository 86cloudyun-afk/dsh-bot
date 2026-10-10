import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerFixture} from './broker-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';
import {AssistantController} from '../../src/native/assistant.mjs';

const command=(action,input,operationId=crypto.randomUUID())=>({operationId,action,input});
async function fixture(t,options={}) {
  const f=await brokerFixture(t,options),bot=await f.bot(),authorSession=await f.contact(bot,'schedule-author');
  const foreign=options.foreignReceiver?await f.bot('Foreign'):null,receiver=foreign?await f.contact(foreign,'schedule-receiver'):authorSession;
  const grant=foreign?{grantId:'schedule-receiver-control',ownerBotId:foreign.botId,recipientBotId:bot.botId,level:'control',scope:{sessions:[receiver.sessionId]},active:true}:null;
  if(grant)await f.policy.authorizeShare(f.human,command('grant.set',grant));
  const author=foreign?f.policy.fromAgent(f.ctx.agents.get(authorSession.sessionId)):f.human;
  let now=Date.parse('2026-10-09T00:00:00Z');
  const assistant=new AssistantController({...f,clock:{now:()=>now,setTimeout(){return 1},clearTimeout(){}}});
  f.broker.setNoticeSink(assistant);f.beforeClose.unshift(()=>assistant.close());
  const schedule=await assistant.createSchedule(author,command('schedule.create',{ownerBotId:bot.botId,kind:'task',recipe:{botId:bot.botId,title:'Original',goal:'One response',criteria:[],originSessionId:receiver.sessionId},rule:{kind:'once',timezone:'UTC',date:'2026-10-09',time:'00:01'}}));
  return {...f,bot,receiver,grant,assistant,schedule,setNow(value){now=Date.parse(value)},async update(input={}) {
    return assistant.updateSchedule(f.human,command('schedule.update',{scheduleId:schedule.scheduleId,expectedVersion:f.store.read().schedules[schedule.scheduleId].version,rule:{kind:'once',timezone:'UTC',date:'2026-10-09',time:'00:16'},...input}));
  }};
}
async function completed(f,occurrence) {
  await eventually(()=>!f.store.read().attempts[occurrence.attemptId].reservationHeld);
  const attempt=f.store.read().attempts[occurrence.attemptId];
  await eventually(()=>['accepted','blocked','UNKNOWN'].includes(f.store.read().outbox[attempt.resultOutboxId]?.state));
  return f.store.read().outbox[attempt.resultOutboxId];
}

for(const legacy of [false,true])test(`future recipe reconfirmation preserves ${legacy?'a legacy':'the current'} admitted original result and admits the new future cycle once`,async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await fixture(t,{stream:async function*(options,index){if(index===1)await gate.promise;yield* textChunks(`Actual response ${index}`);}});
  f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();await eventually(()=>f.requests.length===1);
  const original=Object.values(f.store.read().occurrences)[0],before=f.store.read();assert.equal(original.state,'running');
  if(legacy)await f.store.transact(command('test.legacy-occurrence',{}),draft=>{delete draft.occurrences[original.occurrenceId].consentOperationId;return true;});
  f.setNow('2026-10-09T00:01:10Z');await f.update({recipe:{...f.schedule.recipe,title:'Future'}});
  gate.resolve();const outbox=await completed(f,original);assert.equal(outbox.state,'accepted');
  await eventually(()=>f.requests.length===2);await f.ctx.agents.get(f.receiver.sessionId).whenIdle();await f.assistant.runDue();
  f.setNow('2026-10-09T00:16:00Z');await f.assistant.runDue();
  const current=Object.values(f.store.read().occurrences).find(o=>o.occurrenceId!==original.occurrenceId);assert.ok(current.attemptId);assert.equal(current.consentVersion,2);assert.equal(current.recipe.title,'Future');
  assert.equal((await completed(f,current)).state,'accepted');await eventually(()=>f.requests.length===4);await f.ctx.agents.get(f.receiver.sessionId).whenIdle();
  await f.assistant.runDue();await f.assistant.runDue();
  const after=f.store.read();assert.equal(Object.keys(after.occurrences).length,2);assert.equal(Object.keys(after.attempts).length,2);assert.equal(f.requests.length,4);
  for(const id of [original.createOperationId,original.startOperationId,f.schedule.executionConsent.operationId])assert.deepEqual(after.operations[id],before.operations[id]);
  await f.ctx.sessions.flush(f.ctx.agents.get(f.receiver.sessionId).session);
  const events=(await f.adapter.readNative(f.receiver.sessionId)).events;
  for(const id of [outbox.message.id,after.outbox[after.attempts[current.attemptId].resultOutboxId].message.id])assert.equal(events.filter(e=>e.type==='user/message'&&e.data.id===id).length,1);
});

test('state enable after disabled reconfirmation retires only the proved unadmitted original and runs the new cycle once',async t=>{
  const f=await fixture(t);
  await f.store.transact(command('test.capacity',{}),draft=>{for(let i=0;i<15;i++)draft.attempts[`held-${i}`]={attemptId:`held-${i}`,botId:f.bot.botId,taskId:`held-task-${i}`,state:'running',reservationHeld:true};return true;});
  f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();const old=Object.values(f.store.read().occurrences)[0],before=f.store.read();assert.equal(old.state,'blocked');assert.equal(old.errorCode,'capacity_exhausted');
  f.setNow('2026-10-09T00:01:10Z');const disabled=await f.update({enabled:false});assert.deepEqual(f.store.read().occurrences[old.occurrenceId],old);
  await f.assistant.setScheduleState(f.human,command('schedule.state',{scheduleId:disabled.scheduleId,expectedVersion:disabled.version,enabled:true}));
  const retired=f.store.read().occurrences[old.occurrenceId];assert.equal(retired.state,'missed');assert.equal(retired.errorCode,'schedule_superseded');
  for(const key of ['occurrenceId','taskId','createOperationId','startOperationId','consentVersion','dueAt'])assert.equal(retired[key],old[key]);
  assert.deepEqual(f.store.read().tasks[old.taskId],before.tasks[old.taskId]);assert.deepEqual(f.store.read().operations[old.createOperationId],before.operations[old.createOperationId]);assert.equal(f.store.read().operations[old.startOperationId],undefined);
  await f.store.transact(command('test.capacity-release',{}),draft=>{draft.attempts['held-14'].reservationHeld=false;return true;});
  f.setNow('2026-10-09T00:16:00Z');await f.assistant.runDue();const current=Object.values(f.store.read().occurrences).find(o=>o.occurrenceId!==old.occurrenceId);assert.ok(current.attemptId);assert.equal(current.consentVersion,2);
  assert.equal((await completed(f,current)).state,'accepted');await eventually(()=>f.requests.length===2);await f.ctx.agents.get(f.receiver.sessionId).whenIdle();await f.assistant.runDue();await f.assistant.runDue();
  assert.equal(Object.keys(f.store.read().occurrences).length,2);assert.equal(f.requests.length,2);assert.equal(f.store.read().attempts['held-0'].reservationHeld,true);assert.deepEqual(f.store.read().operations[old.createOperationId],before.operations[old.createOperationId]);
});

test('an admitted original cannot deliver using a substituted creation operation identity',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());const f=await fixture(t,{stream:async function*(){await gate.promise;yield* textChunks('Original response');}});
  f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();await eventually(()=>f.requests.length===1);const original=Object.values(f.store.read().occurrences)[0],before=f.store.read();
  await f.update({recipe:{...f.schedule.recipe,title:'Future'}});
  await f.store.transact(command('test.substituted-creation',{}),draft=>{draft.occurrences[original.occurrenceId].createOperationId='missing-original-create';return true;});
  gate.resolve();const outbox=await completed(f,original);assert.equal(outbox.state,'blocked');assert.equal(outbox.error,'schedule_consent_invalid');assert.equal(f.requests.length,1);
  for(const id of [original.createOperationId,original.startOperationId,f.schedule.executionConsent.operationId])assert.deepEqual(f.store.read().operations[id],before.operations[id]);
});

test('historical admitted Bot consent still requires its currently active foreign receiver control grant',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());const f=await fixture(t,{foreignReceiver:true,stream:async function*(){await gate.promise;yield* textChunks('Original response');}});
  f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();await eventually(()=>f.requests.length===1);const original=Object.values(f.store.read().occurrences)[0],before=f.store.read();
  await f.update({recipe:{...f.schedule.recipe,title:'Future human confirmed recipe'}});
  await f.policy.authorizeShare(f.human,command('grant.set',{...f.grant,active:false}));
  gate.resolve();const outbox=await completed(f,original);assert.equal(outbox.state,'blocked');assert.equal(outbox.error,'access_denied');assert.equal(f.requests.length,1);
  for(const id of [original.createOperationId,original.startOperationId,f.schedule.executionConsent.operationId])assert.deepEqual(f.store.read().operations[id],before.operations[id]);
});

const unsafe={
  UNKNOWN(draft,o){o.state='UNKNOWN';},
  'original-start-receipt'(draft,o){draft.operations[o.startOperationId]={action:'task.start',fingerprint:'uncertain-original',result:{state:'UNKNOWN',occurrenceId:o.occurrenceId}};},
  'lost-original-task'(draft,o){delete draft.tasks[o.taskId];},
  'held-child'(draft,o){draft.attempts['unknown-original-child']={attemptId:'unknown-original-child',taskId:'child-task',occurrenceId:o.occurrenceId,state:'UNKNOWN',reservationHeld:true};},
};
for(const [name,inject] of Object.entries(unsafe))test(`state enable preserves superseded ${name} evidence and forbids a future cycle`,async t=>{
  const f=await fixture(t);await f.store.transact(command('test.capacity',{}),draft=>{for(let i=0;i<15;i++)draft.attempts[`held-${i}`]={attemptId:`held-${i}`,botId:f.bot.botId,taskId:`held-task-${i}`,state:'running',reservationHeld:true};return true;});
  f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();const old=Object.values(f.store.read().occurrences)[0];assert.equal(old.state,'blocked');
  await f.store.transact(command('test.original-unsafe',{}),draft=>{inject(draft,draft.occurrences[old.occurrenceId]);return true;});const before=f.store.read();
  f.setNow('2026-10-09T00:01:10Z');const disabled=await f.update({enabled:false});await f.assistant.setScheduleState(f.human,command('schedule.state',{scheduleId:disabled.scheduleId,expectedVersion:disabled.version,enabled:true}));
  f.setNow('2026-10-09T00:16:00Z');await f.assistant.runDue();const after=f.store.read();assert.deepEqual(after.occurrences[old.occurrenceId],before.occurrences[old.occurrenceId]);assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.outbox,before.outbox);assert.equal(Object.keys(after.occurrences).length,1);assert.equal(f.requests.length,0);
  for(const id of [old.createOperationId,old.startOperationId])assert.deepEqual(after.operations[id],before.operations[id]);
});
