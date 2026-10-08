import test from 'node:test';
import assert from 'node:assert/strict';
import Jobs from '@deepseek-ai/dsh-jobs-local';
import {businessFixture} from './business-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';

export async function taskFixture(t,options={}) {
  const f=await businessFixture(t,options);
  const {TaskController}=await import('../../src/native/tasks.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('native task controller is missing');throw error;});
  const {Reconciler}=await import('../../src/native/recovery.mjs');
  const tasks=new TaskController(f),recovery=new Reconciler({...f,tasks});
  const service=new BotService({...f,tasks,recovery});f.adapter.setService(service);f.beforeClose.push(()=>tasks.close());
  return {...f,tasks,recovery,service,async task(bot,title='Work') {return tasks.create(f.human,{operationId:`task-${title}`,action:'task.create',input:{botId:bot.botId,title,goal:'One harmless response.',criteria:['Response exists']}});}};
}
test('parents children and UNKNOWN attempts share the same fifteen work slots',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());const f=await taskFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('done');}}),bot=await f.bot();
  await f.store.transact({operationId:'held',action:'seed',input:{}},draft=>{for(let i=0;i<13;i++)draft.attempts[`old-${i}`]={attemptId:`old-${i}`,taskId:`old-${i}`,botId:bot.botId,epoch:1,state:'UNKNOWN',reservationHeld:true,depth:0};return null;});
  const parent=await f.task(bot,'Parent'),started=await f.tasks.start(f.human,{operationId:'parent-start',action:'task.start',input:{taskId:parent.taskId,expectedVersion:1}});
  const child=await f.task(bot,'Child'),childAttempt=await f.tasks.start(f.human,{operationId:'child-start',action:'task.start',input:{taskId:child.taskId,expectedVersion:1,parentAttemptId:started.attemptId}});
  assert.equal(childAttempt.depth,1);assert.equal(Object.values(f.store.read().attempts).filter(row=>row.reservationHeld).length,15);
  const next=await f.task(bot,'Overflow');await assert.rejects(f.tasks.start(f.human,{operationId:'overflow',action:'task.start',input:{taskId:next.taskId,expectedVersion:1}}),{code:'capacity_exhausted'});
  await assert.rejects(f.tasks.start(f.human,{operationId:'grandchild',action:'task.start',input:{taskId:next.taskId,expectedVersion:1,parentAttemptId:childAttempt.attemptId}}),{code:'depth_exceeded'});
});
test('stop acceptance keeps the slot until the real model stream settles',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());const f=await taskFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('late result');}}),bot=await f.bot(),task=await f.task(bot);
  const started=await f.tasks.start(f.human,{operationId:'start',action:'task.start',input:{taskId:task.taskId,expectedVersion:1}});await eventually(()=>f.requests.length===1);
  const stopped=await f.tasks.stop(f.human,{operationId:'stop',action:'task.stop',input:{taskId:task.taskId,attemptId:started.attemptId,epoch:started.epoch}});
  assert.equal(stopped.accepted,true);assert.equal(f.store.read().attempts[started.attemptId].reservationHeld,true);
  gate.resolve();await eventually(()=>f.store.read().attempts[started.attemptId].state==='stopped');
  assert.equal(f.store.read().attempts[started.attemptId].reservationHeld,false);assert.equal(f.store.read().tasks[task.taskId].acceptance,'unknown');
});
test('stop acceptance cannot settle a background job whose producer is still alive',async t=>{
  const gate=deferred(),requestGate=deferred();t.after(()=>{gate.resolve({status:'killed'});requestGate.resolve();});
  const f=await taskFixture(t,{stream:async function*(){await requestGate.promise;yield*textChunks('done');}}),jobs=f.ctx.plugin(Jobs);await jobs.await();const detach=f.ctx.jobs.attachController('test');t.after(detach);
  const bot=await f.bot(),task=await f.task(bot),attempt=await f.tasks.start(f.human,{operationId:'start',action:'task.start',input:{taskId:task.taskId,expectedVersion:1}});
  let cancel=0;const jobId=f.ctx.jobs.start({kind:'bash',owner:attempt.sessionId,label:'Controlled producer',run(){return {cancel(){cancel++;},done:gate.promise};}});
  await f.tasks.stop(f.human,{operationId:'stop',action:'task.stop',input:{taskId:task.taskId,attemptId:attempt.attemptId,epoch:attempt.epoch}});requestGate.resolve();
  await eventually(()=>cancel>0);assert.equal(f.ctx.jobs.get(jobId,attempt.sessionId).status,'stopping');assert.equal(f.store.read().attempts[attempt.attemptId].reservationHeld,true);
  gate.resolve({status:'killed'});await eventually(()=>f.store.read().attempts[attempt.attemptId].state==='stopped');
});
test('a stop addressed to an older attempt never cancels a new attempt',async t=>{
  const f=await taskFixture(t),bot=await f.bot(),task=await f.task(bot),first=await f.tasks.start(f.human,{operationId:'first',action:'task.start',input:{taskId:task.taskId,expectedVersion:1}});
  await eventually(()=>!f.store.read().attempts[first.attemptId].reservationHeld);
  const current=f.store.read().tasks[task.taskId],second=await f.tasks.start(f.human,{operationId:'second',action:'task.start',input:{taskId:task.taskId,expectedVersion:current.version}});
  await assert.rejects(f.tasks.stop(f.human,{operationId:'late-stop',action:'task.stop',input:{taskId:task.taskId,attemptId:first.attemptId,epoch:first.epoch}}),{code:'stale_attempt'});
  assert.notEqual(first.attemptId,second.attemptId);
});
test('lost start acknowledgement returns the original attempt and never replays its work',async t=>{
  const f=await taskFixture(t),bot=await f.bot(),task=await f.task(bot),command={operationId:'start',action:'task.start',input:{taskId:task.taskId,expectedVersion:1}};
  const first=await f.tasks.start(f.human,command);await eventually(()=>!f.store.read().attempts[first.attemptId].reservationHeld);
  const again=await f.tasks.start(f.human,command);assert.equal(again.attemptId,first.attemptId);assert.equal(f.requests.length,1);
});
test('acceptance has passed failed and unknown outcomes independently of execution',async t=>{
  const f=await taskFixture(t),bot=await f.bot(),task=await f.task(bot),attempt=await f.tasks.start(f.human,{operationId:'start',action:'task.start',input:{taskId:task.taskId,expectedVersion:1}});
  await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
  for(const outcome of ['unknown','failed','passed']) {
    const current=f.store.read().tasks[task.taskId];const result=await f.tasks.accept(f.human,{operationId:`accept-${outcome}`,action:'task.accept',input:{taskId:task.taskId,expectedVersion:current.version,attemptId:attempt.attemptId,outcome,evidence:'Native test evidence'}});assert.equal(result.acceptance,outcome);
  }
});
test('restart reconciliation preserves UNKNOWN reservations without issuing a request',async t=>{
  const f=await taskFixture(t),bot=await f.bot();
  await f.store.transact({operationId:'crash',action:'seed',input:{}},draft=>{draft.tasks.t={taskId:'t',botId:bot.botId,title:'Interrupted',version:1,currentAttemptId:'a',state:'running'};draft.attempts.a={attemptId:'a',taskId:'t',botId:bot.botId,sessionId:'absent',epoch:1,state:'running',reservationHeld:true,depth:0,runtimeId:'old-runtime'};return null;});
  await f.recovery.reconcile(f.human,{operationId:'reconcile',action:'recovery.reconcile',input:{}});
  assert.equal(f.store.read().attempts.a.state,'UNKNOWN');assert.equal(f.store.read().attempts.a.reservationHeld,true);assert.equal(f.requests.length,0);
  await assert.rejects(f.tasks.start(f.human,{operationId:'no-replay',action:'task.start',input:{taskId:'t',expectedVersion:f.store.read().tasks.t.version}}),{code:'attempt_unsettled'});
});

test('a raw native delegation cannot bypass the plugin work admission',async t=>{
  const f=await taskFixture(t),bot=await f.bot(),channel=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:bot.botId}}),agent=f.ctx.agents.get(channel.sessionId);
  await assert.rejects(f.ctx.agents.create({sessionId:'unadmitted-child',parentAgent:agent,meta:{parentSession:agent.id,origin:'subagent'}}),{code:'work_admission_required'});
  assert.equal(f.ctx.agents.get('unadmitted-child'),undefined);assert.equal(f.requests.length,0);
});

test('adjustment fences the old report and task archives restore without replay',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());const f=await taskFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('old result');}}),bot=await f.bot(),task=await f.task(bot),attempt=await f.tasks.start(f.human,{operationId:'start',action:'task.start',input:{taskId:task.taskId,expectedVersion:1}});
  await eventually(()=>f.requests.length===1);
  const current=f.store.read().tasks[task.taskId];await f.tasks.adjust(f.human,{operationId:'adjust',action:'task.adjust',input:{taskId:task.taskId,expectedVersion:current.version,goal:'Changed goal.'}});
  await assert.rejects(f.tasks.submit(f.human,{operationId:'late',action:'task.submit',input:{taskId:task.taskId,attemptId:attempt.attemptId,epoch:attempt.epoch,report:'old report'}}),{code:'stale_attempt'});
  gate.resolve();await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
  assert.equal(f.store.read().attempts[attempt.attemptId].result,undefined);
  let row=f.store.read().tasks[task.taskId];await f.tasks.archive(f.human,{operationId:'archive',action:'task.archive',input:{taskId:row.taskId,expectedVersion:row.version}});
  row=f.store.read().tasks[task.taskId];await f.tasks.restore(f.human,{operationId:'restore',action:'task.restore',input:{taskId:row.taskId,expectedVersion:row.version}});
  assert.equal(f.store.read().tasks[task.taskId].archived,false);assert.equal(f.requests.length,1);
});
