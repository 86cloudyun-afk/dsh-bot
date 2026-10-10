import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../../src/native/store.mjs';
import {taskFixture} from './task-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

const command=(operationId,action,input)=>({operationId,action,input});

async function controlledTasks(t) {
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await taskFixture(t,{stream:async function*(_options,n){
    await gate.promise;
    if(n<=2){
      yield {type:'block-start',index:0,blockType:'tool-call'};
      yield {type:'block-end',index:0,block:{type:'tool-call',id:`old-help-${n}`,name:'dsh_bot',arguments:JSON.stringify({action:'help',input:{}})}};
      yield {type:'finish',reason:{kind:'tool-calls'}};
    }else yield*textChunks('Obsolete work continued');
  }});
  const controller=await f.bot('AtomicController'),worker=await f.bot('AtomicWorker');
  const contact=await f.sessions.create(f.human,command('atomic-contact','session.create',{botId:controller.botId}));
  const actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  const parent=await f.task(worker,'AtomicParent'),child=await f.task(worker,'AtomicChild');
  const grant={grantId:'atomic-task-control',ownerBotId:worker.botId,recipientBotId:controller.botId,active:true,level:'control',scope:{tasks:[parent.taskId,child.taskId]}};
  await f.policy.authorizeShare(f.human,command('atomic-grant','grant.set',grant));
  const root=await f.tasks.start(f.human,command('atomic-start','task.start',{taskId:parent.taskId,expectedVersion:1}));
  const leaf=await f.tasks.start(f.human,command('atomic-child-start','task.start',{taskId:child.taskId,expectedVersion:1,parentAttemptId:root.attemptId}));
  await eventually(()=>f.requests.length===2);
  return {...f,actor,grant,parent,child,root,leaf,gate};
}

for(const interruption of ['revocation','lost-acknowledgement','caller-disposal'])test(`accepted definition change atomically stops its native old forest after ${interruption}`,async t=>{
  const lostAcknowledgement=interruption==='lost-acknowledgement';
  const f=await controlledTasks(t),adjust=command('atomic-adjust','task.adjust',{taskId:f.parent.taskId,expectedVersion:2,goal:'Only the current definition may run'});
  const callerKey=f.policy.actorKey(f.actor);
  const transact=f.store.transact.bind(f.store);let committed,intercepted=false;
  f.store.transact=async(cmd,mutate)=>{
    const result=await transact(cmd,mutate);
    if(cmd.action==='task.adjust'&&!intercepted){
      intercepted=true;committed=f.store.read();
      await f.policy.authorizeShare(f.human,command('atomic-revoke','grant.set',{...f.grant,active:false}));
      if(interruption==='caller-disposal')await f.adapter.disposeOwned(f.actor.sessionId);
      if(lostAcknowledgement)throw Object.assign(Error('Controlled lost commit acknowledgement'),{code:'atomic_ack_lost'});
    }
    return result;
  };
  let failure;try{await f.tasks.adjust(f.actor,adjust);}catch(error){failure=error.code;}
  assert.equal(committed.attempts[f.root.attemptId].state,'stop_requested','the definition and exact old attempt stop intent must commit together');
  assert.equal(committed.attempts[f.leaf.attemptId].state,'stop_requested','the same commit must fence the admitted descendant');
  const intent=committed.tasks[f.parent.taskId].adjustStop,stop=committed.operations[intent.stopOperationId];
  assert.equal(stop.action,'task.stop');assert.deepEqual(stop.result.attemptIds,[f.root.attemptId,f.leaf.attemptId]);
  assert.equal(stop.fingerprint,digest({...command(intent.stopOperationId,'task.stop',{taskId:f.parent.taskId,attemptId:f.root.attemptId,epoch:f.root.epoch}),callerKey}));
  for(const original of [f.root,f.leaf]){
    const row=committed.attempts[original.attemptId];assert.equal(row.reservationHeld,true);assert.equal(row.epoch,original.epoch);assert.equal(row.stopOperationId,intent.stopOperationId);
    assert.equal(committed.sessions[row.sessionId].state,'stopping');
  }
  assert.equal(failure,lostAcknowledgement?'atomic_ack_lost':undefined);
  if(interruption!=='caller-disposal')await f.tasks.adjust(f.actor,adjust);
  assert.deepEqual(f.store.read().operations[intent.stopOperationId],stop);
  assert.ok(f.requests.every(request=>request.signal.aborted),'already admitted native stop must be dispatched');
  f.gate.resolve();await eventually(()=>[f.root,f.leaf].every(row=>!f.store.read().attempts[row.attemptId].reservationHeld));
  assert.equal(f.requests.length,2,'the accepted stop must prevent any next request under the obsolete definition');
  const state=f.store.read();for(const original of [f.root,f.leaf]){
    const row=state.attempts[original.attemptId];assert.equal(row.state,'stopped');assert.equal(row.localEvidence.known,true);assert.equal(row.localEvidence.settled,true);assert.equal(row.stopOperationId,intent.stopOperationId);
  }
  assert.equal(state.tasks[f.parent.taskId].definitionVersion,2);assert.equal(Object.keys(state.attempts).length,2);
});

test('an authentic original partial adjustment repairs its exact known native forest after control is revoked',async t=>{
  const f=await controlledTasks(t),adjust=command('legacy-atomic-adjust','task.adjust',{taskId:f.parent.taskId,expectedVersion:2,goal:'Already accepted replacement definition'});
  const stamped=f.policy.command(f.actor,adjust),stopOperationId='legacy-original-stop';
  await f.store.transact(command('legacy-adjustment-fixture','fixture.original-partial-adjustment',{}),draft=>{
    const task=draft.tasks[f.parent.taskId];task.goal=adjust.input.goal;task.definitionVersion++;task.version++;task.state='adjusted';task.acceptance='unknown';
    task.adjustStop={operationId:adjust.operationId,stopOperationId,attemptId:f.root.attemptId,epoch:f.root.epoch};
    draft.operations[adjust.operationId]={action:adjust.action,fingerprint:digest(stamped),result:structuredClone(task)};return null;
  });
  await f.policy.authorizeShare(f.human,command('legacy-atomic-revoke','grant.set',{...f.grant,active:false}));
  const accepted=f.store.read().operations[adjust.operationId];
  await f.tasks.adjust(f.actor,adjust);
  assert.equal(f.store.read().attempts[f.root.attemptId].state,'stop_requested');assert.equal(f.store.read().attempts[f.leaf.attemptId].state,'stop_requested');
  assert.deepEqual(f.store.read().operations[adjust.operationId],accepted);assert.equal(f.store.read().operations[stopOperationId].result.attemptId,f.root.attemptId);
  assert.ok(f.requests.every(request=>request.signal.aborted));
  f.gate.resolve();await eventually(()=>[f.root,f.leaf].every(row=>!f.store.read().attempts[row.attemptId].reservationHeld));assert.equal(f.requests.length,2);
});
