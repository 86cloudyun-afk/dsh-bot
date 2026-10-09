import test from 'node:test';
import assert from 'node:assert/strict';
import { brokerFixture } from './broker-fixture.mjs';
import { digest } from '../../src/native/store.mjs';
import { eventually } from './official-fixture.mjs';

async function scheduled(f,bot,dependsOn=[]) {
  const receiver=await f.contact(bot,'schedule-receiver');
  const recipe={botId:bot.botId,title:'Scheduled work',goal:'One actual response',criteria:['Actual persisted result'],dependsOn,originSessionId:receiver.sessionId};
  const occurrenceId='occurrence-fixed',scheduleId='schedule-fixed';
  await f.store.transact({operationId:'schedule-seed',action:'seed',input:{}},draft=>{
    draft.schedules[scheduleId]={scheduleId,ownerBotId:bot.botId,enabled:true,archived:false,consentVersion:1,recipe,executionConsent:{configRevision:bot.configRevision}};
    draft.occurrences[occurrenceId]={occurrenceId,scheduleId,consentVersion:1,state:'claimed',recipe,recipeHash:digest(recipe),configRevision:bot.configRevision,createOperationId:'scheduled-create',startOperationId:'scheduled-start',taskId:null,attemptId:null};return null;
  });
  f.policy.registerScheduleAuthority((id,state)=>{
    assert.equal(id,occurrenceId);
    const row=state.occurrences[id];return {...row,botId:bot.botId,sessionId:receiver.sessionId,origins:[]};
  });
  return {actor:f.policy.fromScheduleOccurrence(occurrenceId),create:{operationId:'scheduled-create',action:'task.create',input:{occurrenceId}},start:{operationId:'scheduled-start',action:'task.start',input:{occurrenceId}},occurrenceId};
}

test('scheduled task create/start persist occurrence identities atomically, retain fixed receipts and use actual broker result',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),s=await scheduled(f,bot);
  const task=await f.tasks.createScheduled(s.actor,s.create);
  assert.equal(f.store.read().occurrences[s.occurrenceId].taskId,task.taskId);
  assert.deepEqual(task.createdBy,{kind:'schedule',occurrenceId:s.occurrenceId,scheduleId:'schedule-fixed'});
  assert.equal(task.source.kind,'schedule');assert.deepEqual(await f.tasks.createScheduled(s.actor,s.create),task);
  const attempt=await f.tasks.startScheduled(s.actor,s.start);
  assert.equal(f.store.read().occurrences[s.occurrenceId].attemptId,attempt.attemptId);
  assert.equal((await f.tasks.startScheduled(s.actor,s.start)).attemptId,attempt.attemptId);
  await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
  assert.ok(f.store.read().attempts[attempt.attemptId].result);
  assert.equal(Object.keys(f.store.read().tasks).length,1);assert.equal(Object.keys(f.store.read().attempts).length,1);
  const outbox=f.store.read().outbox[attempt.resultOutboxId];assert.equal(outbox.taskId,task.taskId);assert.equal(outbox.sessionId,task.originSessionId);
});

test('forged schedule actors and recipe injection cannot create native work; blocked dependencies preserve occurrence task identity',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),upstream=await f.task(bot,'Unaccepted'),s=await scheduled(f,bot,[upstream.taskId]);
  await assert.rejects(f.tasks.createScheduled({...s.actor},s.create),{code:'access_denied'});
  await assert.rejects(f.tasks.createScheduled(s.actor,{...s.create,input:{...s.create.input,title:'Injected'}}),{code:'access_denied'});
  const task=await f.tasks.createScheduled(s.actor,s.create);
  await assert.rejects(f.tasks.startScheduled(s.actor,s.start),{code:'dependency_blocked'});
  assert.equal(f.store.read().occurrences[s.occurrenceId].taskId,task.taskId);assert.equal(f.store.read().occurrences[s.occurrenceId].attemptId,null);
  assert.equal(Object.keys(f.store.read().attempts).length,0);assert.equal(f.requests.length,0);
});

test('UNKNOWN scheduled start retains original attempt and cannot replay native request',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),s=await scheduled(f,bot);await f.tasks.createScheduled(s.actor,s.create);
  const create=f.adapter.createOwned.bind(f.adapter);f.adapter.createOwned=async binding=>{await create(binding);throw Object.assign(Error('Lost receipt'),{code:'lost_receipt'});};
  await assert.rejects(f.tasks.startScheduled(s.actor,s.start),{code:'lost_receipt'});
  const occurrence=f.store.read().occurrences[s.occurrenceId],attempt=f.store.read().attempts[occurrence.attemptId];
  assert.equal(attempt.state,'UNKNOWN');assert.equal(attempt.reservationHeld,true);
  assert.equal((await f.tasks.startScheduled(s.actor,s.start)).attemptId,attempt.attemptId);
  assert.equal(f.requests.length,0);assert.equal(Object.keys(f.store.read().attempts).length,1);
});

test('scheduled first start rejects an unavailable current execution model before reserving an attempt',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),s=await scheduled(f,bot);await f.tasks.createScheduled(s.actor,s.create);
  const validate=f.adapter.validateModel.bind(f.adapter);f.adapter.validateModel=async()=>{throw Object.assign(Error('Unavailable catalog selection'),{code:'model_unavailable'});};
  await assert.rejects(f.tasks.startScheduled(s.actor,s.start),{code:'model_unavailable'});
  assert.equal(f.store.read().occurrences[s.occurrenceId].attemptId,null);assert.equal(Object.keys(f.store.read().attempts).length,0);assert.equal(f.requests.length,0);
  f.adapter.validateModel=validate;
});
