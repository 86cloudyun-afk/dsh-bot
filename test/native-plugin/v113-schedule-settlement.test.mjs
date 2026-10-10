import test from 'node:test';
import assert from 'node:assert/strict';
import {AssistantController} from '../../src/native/assistant.mjs';
import {TaskController} from '../../src/native/tasks.mjs';
import {businessFixture} from './business-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

const command=(action,input,operationId=crypto.randomUUID())=>({action,input,operationId});

for(const action of ['pause','cancel'])test(`schedule ${action} reconciles its original admitted occurrence after native settlement`,async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await businessFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('Original admitted scheduled response');}});
  const bot=await f.bot(),session=await f.sessions.create(f.human,command('session.create',{botId:bot.botId}));
  let now=Date.parse('2026-10-09T00:00:00Z'),nextTimer=0;const timers=new Map();
  const tasks=new TaskController(f),assistant=new AssistantController({...f,tasks,clock:{now:()=>now,setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}}});
  f.beforeClose.push(()=>assistant.close(),()=>tasks.close());
  const schedule=await assistant.createSchedule(f.human,command('schedule.create',{ownerBotId:bot.botId,kind:'task',rule:{kind:'once',timezone:'UTC',date:'2026-10-09',time:'00:01'},recipe:{botId:bot.botId,title:'Original scheduled task',goal:'Produce one real reply',criteria:[],originSessionId:session.sessionId}}));
  await assistant.start();now=Date.parse('2026-10-09T00:01:00Z');await assistant.runDue();await eventually(()=>f.requests.length===1);
  const original=Object.values(f.store.read().occurrences)[0],operationIds=[original.consentOperationId,original.createOperationId,original.startOperationId],receipts=operationIds.map(id=>f.store.read().operations[id]);
  await assistant.setScheduleState(f.human,command(`schedule.${action}`,{scheduleId:schedule.scheduleId,expectedVersion:f.store.read().schedules[schedule.scheduleId].version,enabled:false,...(action==='cancel'?{archived:true}:{})}));
  assert.equal(f.store.read().attempts[original.attemptId].reservationHeld,true);assert.equal(timers.size,0,'running native work needs no reconciliation loop');
  gate.resolve();await eventually(()=>!f.store.read().attempts[original.attemptId].reservationHeld);
  assert.equal(f.adapter.resources(f.store.read().attempts[original.attemptId].sessionId).settled,true);
  assert.equal(timers.size,1,'native settlement must arm reconciliation for a disabled schedule');
  const timer=[...timers.values()][0];assert.equal(timer.ms,0);timers.clear();await timer.fn();
  const state=f.store.read(),occurrence=state.occurrences[original.occurrenceId];
  assert.equal(occurrence.state,'settled');assert.equal(occurrence.attemptId,original.attemptId);
  assert.equal(state.schedules[schedule.scheduleId].enabled,false);assert.equal(state.schedules[schedule.scheduleId].archived,action==='cancel');
  assert.deepEqual(operationIds.map(id=>state.operations[id]),receipts);assert.equal(Object.keys(state.attempts).length,1);assert.equal(f.requests.length,1);assert.equal(timers.size,0);
});
