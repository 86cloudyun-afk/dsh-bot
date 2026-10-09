import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFixture} from './business-fixture.mjs';
import {eventually,deferred,textChunks} from './official-fixture.mjs';
import {AssistantController} from '../../src/native/assistant.mjs';
import {TaskController} from '../../src/native/tasks.mjs';

async function fixture(t,options={}) {
  const f=await businessFixture(t,options),bot=await f.bot(),session=await f.sessions.create(f.human,{operationId:'contact',action:'session.create',input:{botId:bot.botId}});
  let now=Date.parse('2026-10-09T00:00:00Z');
  const tasks=new TaskController(f),assistant=new AssistantController({...f,tasks,clock:{now:()=>now,setTimeout(){return 1},clearTimeout(){}}});
  f.beforeClose.unshift(()=>assistant.close(),()=>tasks.close());
  const schedule=await assistant.createSchedule(f.human,{operationId:'schedule',action:'schedule.create',input:{ownerBotId:bot.botId,kind:'task',recipe:{botId:bot.botId,title:'Original',goal:'One response',criteria:[],originSessionId:session.sessionId},rule:{kind:'once',timezone:'UTC',date:'2026-10-09',time:'00:01'}}});
  return {...f,bot,session,tasks,assistant,schedule,setNow(value){now=Date.parse(value)},async confirm(){return assistant.updateSchedule(f.human,{operationId:'confirm',action:'schedule.update',input:{scheduleId:schedule.scheduleId,expectedVersion:f.store.read().schedules[schedule.scheduleId].version,enabled:true,rule:{kind:'once',timezone:'UTC',date:'2026-10-09',time:'00:16'}}});}};
}
async function capacity(f) {
  await f.store.transact({operationId:'fill-capacity',action:'test.capacity'},draft=>{for(let i=0;i<15;i++)draft.attempts[`held-${i}`]={attemptId:`held-${i}`,botId:f.bot.botId,taskId:`held-task-${i}`,state:i===0?'UNKNOWN':'running',reservationHeld:true};return true;});
  f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();
  const old=Object.values(f.store.read().occurrences)[0];assert.equal(old.state,'blocked');assert.equal(old.errorCode,'capacity_exhausted');assert.ok(old.taskId);assert.equal(old.attemptId,undefined);return old;
}
for(const kind of ['config-drift','15-slot-capacity'])test(`reconfirmation retires only superseded unadmitted ${kind} and executes the new trigger once`,async t=>{
  const f=await fixture(t);let old;
  if(kind==='config-drift') {
    await f.bots.update(f.human,{operationId:'change-model',action:'bot.update',input:{botId:f.bot.botId,expectedVersion:f.bot.revision,execution:{provider:'controlled',model:'model-b'},executionMode:'explicit'}});
    f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();old=Object.values(f.store.read().occurrences)[0];assert.equal(old.errorCode,'schedule_config_changed');assert.equal(old.taskId,undefined);
  } else old=await capacity(f);
  const before=f.store.read(),createReceipt=before.operations[old.createOperationId];assert.equal(before.operations[old.startOperationId],undefined);assert.equal(f.requests.length,0);
  f.setNow('2026-10-09T00:01:10Z');const confirmed=await f.confirm();assert.equal(confirmed.consentVersion,2);
  const saved=f.store.read().occurrences[old.occurrenceId];assert.equal(saved.state,'missed');assert.equal(saved.errorCode,'schedule_superseded');assert.equal(saved.version,old.version+1);
  for(const key of ['occurrenceId','taskId','createOperationId','startOperationId','consentVersion','dueAt'])assert.equal(saved[key],old[key]);
  assert.deepEqual(f.store.read().operations[old.createOperationId],createReceipt);
  await f.assistant.runDue();assert.equal(f.store.read().schedules[f.schedule.scheduleId].enabled,true);assert.equal(f.requests.length,0);
  if(kind==='15-slot-capacity')await f.store.transact({operationId:'release-one-slot',action:'test.capacity'},draft=>{draft.attempts['held-14'].reservationHeld=false;return true;});
  f.setNow('2026-10-09T00:16:00Z');await f.assistant.runDue();
  const current=Object.values(f.store.read().occurrences).find(o=>o.occurrenceId!==old.occurrenceId);assert.ok(current.attemptId);assert.equal(current.consentVersion,2);assert.notEqual(current.taskId,old.taskId);
  await eventually(()=>!f.store.read().attempts[current.attemptId].reservationHeld);await f.assistant.runDue();await f.assistant.runDue();
  assert.equal(f.requests.length,1);assert.equal(Object.keys(f.store.read().occurrences).length,2);assert.equal(f.store.read().operations[old.startOperationId],undefined);assert.deepEqual(f.store.read().operations[old.createOperationId],createReceipt);
  if(kind==='15-slot-capacity'){assert.deepEqual(f.store.read().tasks[old.taskId],before.tasks[old.taskId]);assert.equal(f.store.read().attempts['held-0'].reservationHeld,true);}
});

test('a disabled recipe edit preserves a planned original until enabled reconfirmation',async t=>{
  const f=await fixture(t),old=await capacity(f);
  await f.store.transact({operationId:'planned-original',action:'test.evidence'},draft=>{const o=draft.occurrences[old.occurrenceId];o.state='planned';delete o.errorCode;return true;});
  const before=f.store.read().occurrences[old.occurrenceId];f.setNow('2026-10-09T00:01:10Z');
  const disabled=await f.assistant.updateSchedule(f.human,{operationId:'disabled-edit',action:'schedule.update',input:{scheduleId:f.schedule.scheduleId,expectedVersion:f.store.read().schedules[f.schedule.scheduleId].version,enabled:false,rule:{kind:'once',timezone:'UTC',date:'2026-10-09',time:'00:16'}}});
  assert.deepEqual(f.store.read().occurrences[old.occurrenceId],before);
  await f.assistant.updateSchedule(f.human,{operationId:'enabled-confirm',action:'schedule.update',input:{scheduleId:f.schedule.scheduleId,expectedVersion:disabled.version,enabled:true}});
  const saved=f.store.read().occurrences[old.occurrenceId];assert.equal(saved.state,'missed');assert.equal(saved.consentVersion,1);assert.equal(saved.taskId,old.taskId);assert.equal(saved.startOperationId,old.startOperationId);assert.equal(saved.version,before.version+1);assert.equal(f.requests.length,0);
});

const unsafe={
  UNKNOWN(draft,o){o.state='UNKNOWN';},
  'original-start-receipt'(draft,o){draft.operations[o.startOperationId]={action:'task.start',fingerprint:'original-start',result:{state:'UNKNOWN',occurrenceId:o.occurrenceId}};},
  'unknown-create-receipt'(draft,o){draft.operations[o.createOperationId].result.state='UNKNOWN';},
  'unknown-linked-operation'(draft,o){draft.operations['uncertain-operation']={action:'task.start',fingerprint:'uncertain',result:{state:'UNKNOWN',taskId:o.taskId}};},
  'missing-original-task'(draft,o){delete draft.tasks[o.taskId];},
  'task-current-attempt'(draft,o){draft.tasks[o.taskId].currentAttemptId='lost-attempt';},
  'task-admitted-epoch'(draft,o){draft.tasks[o.taskId].epoch=1;},
  'task-UNKNOWN-state'(draft,o){draft.tasks[o.taskId].state='UNKNOWN';},
  'task-attempt'(draft,o){draft.attempts['old-attempt']={attemptId:'old-attempt',taskId:o.taskId,state:'completed',reservationHeld:false};},
  'occurrence-child-attempt'(draft,o){draft.attempts['unknown-child']={attemptId:'unknown-child',taskId:'child-task',occurrenceId:o.occurrenceId,parentAttemptId:'old-parent',state:'UNKNOWN',reservationHeld:true};},
  'blocked-result-outbox'(draft,o){draft.outbox['old-result']={outboxId:'old-result',kind:'result',taskId:o.taskId,state:'blocked',operationId:'old-result-operation',message:{id:'old-native-message'}};},
  'unknown-occurrence-outbox'(draft,o){draft.outbox['old-result']={outboxId:'old-result',occurrenceId:o.occurrenceId,state:'UNKNOWN'};},
  'pending-operation-outbox'(draft,o){draft.outbox['old-result']={outboxId:'old-result',operationId:o.startOperationId,state:'queued'};},
};
for(const [name,inject] of Object.entries(unsafe))test(`reconfirmation preserves ${name} and prevents a new cycle`,async t=>{
  const f=await fixture(t),old=await capacity(f);
  await f.store.transact({operationId:'unsafe-evidence',action:'test.evidence'},draft=>{inject(draft,draft.occurrences[old.occurrenceId]);return true;});
  const before=f.store.read();f.setNow('2026-10-09T00:01:10Z');await f.confirm();
  assert.deepEqual(f.store.read().occurrences[old.occurrenceId],before.occurrences[old.occurrenceId]);
  await f.assistant.runDue();f.setNow('2026-10-09T00:16:00Z');await f.assistant.runDue();
  const after=f.store.read();assert.deepEqual(after.occurrences[old.occurrenceId],before.occurrences[old.occurrenceId]);assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.outbox,before.outbox);
  assert.deepEqual(after.operations[old.createOperationId],before.operations[old.createOperationId]);assert.deepEqual(after.operations[old.startOperationId],before.operations[old.startOperationId]);assert.equal(Object.keys(after.occurrences).length,1);assert.equal(f.requests.length,0);
});

test('reconfirmation cannot bypass actual admitted work or a held descendant resource',async t=>{
  const gate=deferred(),f=await fixture(t,{stream:async function*(){await gate.promise;yield* textChunks('Original response');}});
  try {
    f.setNow('2026-10-09T00:01:00Z');await f.assistant.runDue();await eventually(()=>f.requests.length===1);
    const old=Object.values(f.store.read().occurrences)[0],before=f.store.read();assert.equal(old.state,'running');assert.ok(before.operations[old.startOperationId]);assert.equal(before.attempts[old.attemptId].reservationHeld,true);
    await f.store.transact({operationId:'held-child',action:'test.evidence'},draft=>{draft.attempts['held-child']={attemptId:'held-child',taskId:'child-task',parentAttemptId:old.attemptId,state:'UNKNOWN',reservationHeld:true};return true;});
    f.setNow('2026-10-09T00:01:10Z');await f.confirm();assert.deepEqual(f.store.read().occurrences[old.occurrenceId],old);
    f.setNow('2026-10-09T00:16:00Z');await f.assistant.runDue();const after=f.store.read(),saved=after.occurrences[old.occurrenceId];
    assert.equal(saved.state,'running');assert.equal(saved.attemptId,old.attemptId);assert.equal(saved.consentVersion,1);assert.equal(after.attempts['held-child'].reservationHeld,true);assert.deepEqual(after.operations[old.startOperationId],before.operations[old.startOperationId]);assert.equal(Object.keys(after.occurrences).length,1);assert.equal(f.requests.length,1);
  } finally {gate.resolve();}
});

test('reconfirmation during claimed native validation preserves old IDs and forbids native admission',async t=>{
  const f=await fixture(t),gate=deferred(),entered=deferred(),validate=f.adapter.validateModel.bind(f.adapter);
  f.adapter.validateModel=async(...args)=>{entered.resolve();await gate.promise;return validate(...args);};
  f.setNow('2026-10-09T00:01:00Z');const pending=f.assistant.runDue();await entered.promise;
  const old=Object.values(f.store.read().occurrences)[0];assert.equal(old.state,'claimed');
  f.setNow('2026-10-09T00:01:10Z');await f.confirm();assert.deepEqual(f.store.read().occurrences[old.occurrenceId],old);
  gate.resolve();await pending;f.setNow('2026-10-09T00:16:00Z');await f.assistant.runDue();
  const state=f.store.read(),saved=state.occurrences[old.occurrenceId];assert.equal(saved.state,'blocked');assert.equal(saved.consentVersion,1);assert.equal(saved.startOperationId,old.startOperationId);assert.equal(Object.keys(state.tasks).length,0);assert.equal(Object.keys(state.occurrences).length,1);assert.equal(f.requests.length,0);
  assert.equal(state.schedules[f.schedule.scheduleId].enabled,true);
});
