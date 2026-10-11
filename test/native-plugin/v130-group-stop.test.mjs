import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {GroupMeetingController} from '../../src/native/collaboration.mjs';
import {Reconciler} from '../../src/native/recovery.mjs';
import {collaborationFixture} from './collaboration-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

const command=(operationId,action,input)=>({operationId,action,input});
const post=(f,g,id='post')=>f.service.dispatch(f.human,command(id,'group.post',{groupId:g.groupId,text:id}));
const stop=(f,g,r,id='stop')=>f.service.dispatch(f.human,command(id,'group.round.stop',{groupId:g.groupId,roundId:r.roundId}));
const round=(f,g,r)=>f.store.read().groups[g.groupId].rounds[r.roundId];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const waitSignal=async(options,gate)=>{
  await Promise.race([gate.promise,new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}))]);
  options.signal.throwIfAborted();
};
async function seedHistory(f,g,count,id='seed-history') {
  return f.store.transact(command(id,'fixture.history',{}),draft=>{
    const messages=draft.groups[g.groupId].messages;
    while(messages.length<count)messages.push({messageId:`historical-${messages.length}`,groupId:g.groupId,text:`Original historic text ${messages.length}`,producer:{kind:'human'}});
    return null;
  });
}
async function held(t) {
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await collaborationFixture(t,{stream:async function*(options){await waitSignal(options,gate);yield*textChunks('Held real reply');}}),
    a=await f.bot('A'),b=await f.bot('B'),g=await f.group('Held',[a,b]),r=await post(f,g);
  await eventually(()=>f.requests.length===1);
  return {...f,a,b,g,r,gate};
}

// Removing the registered human route makes the real stop command fail.
test('v1.3 stop is registered with exact human-only input',async t=>{
  const f=await collaborationFixture(t);
  const help=await f.service.dispatch(f.human,{action:'help',input:{action:'group.round.stop'}});
  assert.deepEqual(help.commands['group.round.stop'].required,['groupId','roundId']);
  assert.deepEqual(help.commands['group.round.stop'].optional,[]);
  assert.equal(help.commands['group.round.stop'].humanOnly,true);
});

// A stop that only cancels the native reply would still admit member B.
test('v1.3 stopping a held first member fences the second request and preserves real request evidence',async t=>{
  const f=await held(t),receipt=await stop(f,f.g,f.r),sid=round(f,f.g,f.r).channels[0];
  assert.deepEqual(receipt,{groupId:f.g.groupId,roundId:f.r.roundId,accepted:true,state:'stopping',settled:false,channels:[sid]});
  await eventually(()=>round(f,f.g,f.r).state==='stopped','stopped group resource proof');
  const saved=round(f,f.g,f.r);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].signal.aborted,true);
  assert.equal(saved.requests,1);assert.deepEqual(saved.channels,[sid]);
  assert.equal(f.store.read().groups[f.g.groupId].messages.length,1);
  assert.equal(f.store.read().sessions[sid].state,'settled');
  assert.equal(f.adapter.resources(sid).known,true);assert.equal(f.adapter.resources(sid).settled,true);
  assert.equal(saved.stopEvidence[0].resources.requests.length,1);
  assert.equal(saved.stopEvidence[0].resources.requests[0].submitted,true);
});

// Dropping the post-create guard lets an already stopped native channel receive followup.
test('v1.3 stopping while createOwned awaits prevents followup and waits for creation proof',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await collaborationFixture(t),a=await f.bot('A'),b=await f.bot('B'),g=await f.group('Create',[a,b]);
  const create=f.adapter.createOwned.bind(f.adapter);let entered=false,followups=0;
  f.adapter.createOwned=async(binding,...args)=>{entered=true;await gate.promise;const h=await create(binding,...args),followup=h.agent.followup.bind(h.agent);h.agent.followup=(...values)=>{followups++;return followup(...values);};return h;};
  const r=await post(f,g);await eventually(()=>entered);
  await stop(f,g,r);await tick();
  assert.equal(round(f,g,r).state,'stopping');assert.equal(f.requests.length,0);
  gate.resolve();await eventually(()=>round(f,g,r).state==='stopped');
  assert.equal(followups,0);assert.equal(f.requests.length,0);assert.equal(round(f,g,r).channels.length,1);
  assert.equal(f.store.read().sessions[round(f,g,r).channels[0]].state,'settled');
});

// A worker queued behind a stop must not reserve any new native channel.
test('v1.3 channel reservation checks durable stop intent inside the transaction',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await collaborationFixture(t),a=await f.bot('A'),g=await f.group('Reserve',[a]);
  const transact=f.store.transact.bind(f.store);let entered=false;
  f.store.transact=async(c,mutate)=>{if(c.action==='group.channel'){entered=true;await gate.promise;}return transact(c,mutate);};
  const r=await post(f,g);await eventually(()=>entered);await stop(f,g,r);
  gate.resolve();await eventually(()=>round(f,g,r).state==='stopped');
  assert.deepEqual(round(f,g,r).channels,[]);assert.equal(f.requests.length,0);
});

// The adapter's real transaction must reject an admission queued before stopping.
test('v1.3 queued native admission after stop never reaches the controlled provider',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await collaborationFixture(t),a=await f.bot('A'),g=await f.group('Admission',[a]);
  const transact=f.store.transact.bind(f.store);let entered=false;
  f.store.transact=async(c,mutate)=>{if(c.action==='collaboration.request-admitted'){entered=true;await gate.promise;}return transact(c,mutate);};
  const r=await post(f,g);await eventually(()=>entered);await stop(f,g,r);gate.resolve();
  await eventually(()=>round(f,g,r).state==='stopped');assert.equal(f.requests.length,0);assert.equal(round(f,g,r).requests,0);
});

// A completed model result awaiting publication must still be fenced.
test('v1.3 stopping a completed reply awaiting publication preserves its native log without appending',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await collaborationFixture(t),a=await f.bot('A'),b=await f.bot('B'),g=await f.group('Publish',[a,b]);
  const transact=f.store.transact.bind(f.store);let sid;
  f.store.transact=async(c,mutate)=>{if(c.action==='group.reply'){sid=c.input.sessionId;await gate.promise;}return transact(c,mutate);};
  const r=await post(f,g);await eventually(()=>sid);await stop(f,g,r);gate.resolve();
  await eventually(()=>round(f,g,r).state==='stopped');
  assert.equal(f.requests.length,1);assert.equal(f.store.read().groups[g.groupId].messages.length,1);
  const native=await f.adapter.readNative(sid);assert.ok(native.events.some(e=>e.type==='assistant/message'));
  assert.ok(native.events.some(e=>e.type==='turn/end'&&e.data.reason.kind==='completed'));
});

// An unconditional complete mutation overwrites stopping after the last worker finishes.
test('v1.3 finish race cannot replace stopping with complete',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await collaborationFixture(t),a=await f.bot('A'),g=await f.group('Finish',[a]);
  const transact=f.store.transact.bind(f.store);let entered=false;
  f.store.transact=async(c,mutate)=>{if(c.action==='group.round-complete'){entered=true;await gate.promise;}return transact(c,mutate);};
  const r=await post(f,g);await eventually(()=>entered);await stop(f,g,r);gate.resolve();
  await eventually(()=>round(f,g,r).state==='stopped');assert.equal(f.store.read().groups[g.groupId].messages.length,2);
  assert.equal(round(f,g,r).requests,1);
});

// Canceling by Bot or by purpose would affect independent concurrent owned work.
test('v1.3 exact round stop leaves another round, group, contact and task unchanged',async t=>{
  let f;const gate=deferred(),privateGate=deferred();t.after(()=>{gate.resolve();privateGate.resolve();});
  f=await collaborationFixture(t,{stream:async function*(options){const binding=f.store.read().sessions[options.sessionId];if(binding.purpose==='group'&&binding.lineage.roundId===target?.roundId)await waitSignal(options,gate);if(['contact','execution'].includes(binding.purpose))await waitSignal(options,privateGate);yield*textChunks('Unrelated original work');}});
  const a=await f.bot('A'),b=await f.bot('B'),g=await f.group('Target',[a,b]),other=await f.group('Other',[a]);let target;
  target=await post(f,g,'target');await eventually(()=>f.requests.length===1);
  const different=await post(f,g,'different'),otherRound=await post(f,other,'other');
  await eventually(()=>round(f,g,different).state==='complete'&&round(f,other,otherRound).state==='complete');
  const contact=await f.contact(a,'contact'),contactAgent=f.ctx.agents.get(contact.sessionId);
  contactAgent.followup(createUserMessage({content:[{type:'text',text:'Private contact'}],source:{kind:'user'}}));await eventually(()=>f.requests.some(row=>row.sessionId===contact.sessionId));
  const task=await f.task(a,'Unrelated'),attempt=await f.tasks.start(f.human,command('task-start','task.start',{taskId:task.taskId,expectedVersion:1}));
  await eventually(()=>f.requests.some(row=>row.sessionId===attempt.sessionId));
  await f.ctx.sessions.flush(contactAgent.session);
  const before=f.store.read(),native=await f.adapter.readNative(contact.sessionId);
  await stop(f,g,target);await eventually(()=>round(f,g,target).state==='stopped');const after=f.store.read();
  assert.deepEqual(after.groups[other.groupId],before.groups[other.groupId]);
  assert.deepEqual(after.groups[g.groupId].rounds[different.roundId],before.groups[g.groupId].rounds[different.roundId]);
  assert.deepEqual(after.tasks[task.taskId],before.tasks[task.taskId]);assert.deepEqual(after.attempts[attempt.attemptId],before.attempts[attempt.attemptId]);
  assert.deepEqual(after.sessions[contact.sessionId],before.sessions[contact.sessionId]);await f.ctx.sessions.flush(contactAgent.session);assert.deepEqual(await f.adapter.readNative(contact.sessionId),native);
  assert.equal(f.requests.find(row=>row.sessionId===contact.sessionId).signal.aborted,false);
  assert.equal(f.requests.find(row=>row.sessionId===attempt.sessionId).signal.aborted,false);
  assert.equal(after.attempts[attempt.attemptId].reservationHeld,true);
  privateGate.resolve();await contactAgent.whenIdle();await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
});

test('v1.3 original operation replay returns its receipt without another native stop',async t=>{
  const f=await held(t),realStop=f.adapter.stopResources.bind(f.adapter);let calls=0;
  f.adapter.stopResources=async(...args)=>{calls++;return realStop(...args);};
  const receipt=await stop(f,f.g,f.r);await eventually(()=>round(f,f.g,f.r).state==='stopped');const count=calls;
  assert.deepEqual(await stop(f,f.g,f.r),receipt);await tick();assert.equal(calls,count);
  const lookup=await f.service.dispatch(f.human,{action:'operation.lookup',input:{operationId:'stop',request:command('stop','group.round.stop',{groupId:f.g.groupId,roundId:f.r.roundId})}});
  assert.deepEqual(lookup.result,receipt);
  await assert.rejects(f.service.dispatch(f.human,command('stop','group.round.stop',{groupId:f.g.groupId,roundId:'other'})),{code:'operation_conflict'});
});

// The stop covers every created original channel, including earlier settled members.
test('v1.3 stopResources receives every original channel after an earlier member completed',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());let f,b;
  f=await collaborationFixture(t,{stream:async function*(options){if(f.store.read().sessions[options.sessionId].botId===b?.botId)await waitSignal(options,gate);yield*textChunks('Real sequential reply');}});
  const a=await f.bot('A');b=await f.bot('B');const g=await f.group('AllChannels',[a,b]),r=await post(f,g);
  await eventually(()=>f.requests.length===2);const original=round(f,g,r),first=original.channels[0],stopResource=f.adapter.stopResources.bind(f.adapter),calls=[];
  assert.equal(f.adapter.context.agents.get(first),undefined);assert.equal(f.adapter.resources(first).settled,true);
  f.adapter.stopResources=async id=>{calls.push(id);return stopResource(id);};
  await stop(f,g,r);await eventually(()=>round(f,g,r).state==='stopped');
  assert.deepEqual([...new Set(calls)].sort(),[...original.channels].sort());
  assert.equal(f.requests.length,2);assert.equal(round(f,g,r).requests,2);
  assert.equal(f.store.read().groups[g.groupId].messages.length,2,'original first reply survives; stopped second reply is suppressed');
});

for(const input of [{},{groupId:'bad id',roundId:'round'},{groupId:'group',roundId:'constructor'},{groupId:'group',roundId:'round',extra:true}])
  test(`v1.3 malformed stop input is rejected without a receipt ${JSON.stringify(input)}`,async t=>{
    const f=await collaborationFixture(t),before=f.store.read();
    await assert.rejects(f.service.dispatch(f.human,command('malformed','group.round.stop',input)),{code:input.extra?'invalid_command':'invalid_input'});
    assert.deepEqual(f.store.read(),before);
  });

test('v1.3 a foreign round ID cannot stop this group and Bots cannot issue or replay stop',async t=>{
  const f=await held(t),g=await f.group('Foreign',[f.a]),contact=await f.contact(f.a,'stop-caller'),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  await assert.rejects(stop(f,g,f.r,'foreign'),{code:'not_found'});
  const c=command('stop','group.round.stop',{groupId:f.g.groupId,roundId:f.r.roundId});
  await assert.rejects(f.service.dispatch(actor,c),{code:'access_denied'});
  await f.service.dispatch(f.human,c);await eventually(()=>round(f,f.g,f.r).state==='stopped');
  await assert.rejects(f.service.dispatch(actor,c),{code:'access_denied'});
});

test('v1.3 complete and stopped rounds are durable terminal no-ops',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('A'),g=await f.group('Terminal',[a]),r=await post(f,g);
  await eventually(()=>round(f,g,r).state==='complete');const before=round(f,g,r);let calls=0;
  f.adapter.stopResources=async()=>{calls++;};
  assert.deepEqual(await stop(f,g,r),{groupId:g.groupId,roundId:r.roundId,accepted:false,state:'complete',settled:true,channels:before.channels});
  assert.deepEqual(round(f,g,r),before);assert.equal(calls,0);
  await f.store.transact(command('stopped-fixture','fixture',{}),draft=>{draft.groups[g.groupId].rounds[r.roundId].state='stopped';return null;});
  const receipt=await stop(f,g,r,'stopped-noop');assert.equal(receipt.accepted,false);assert.equal(receipt.state,'stopped');assert.equal(calls,0);
});

// A terminal round state does not prove settlement of its original native channels.
test('v1.3 complete UNKNOWN channels return unsettled no-op receipts while valid complete proof stays settled',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('A'),g=await f.group('TerminalUnknown',[a]),resources=f.adapter.resources.bind(f.adapter);
  f.adapter.resources=id=>f.store.read().sessions[id]?.lineage?.groupId===g.groupId?{known:false,settled:false}:resources(id);
  const r=await post(f,g);await eventually(()=>round(f,g,r).state==='complete');const sid=round(f,g,r).channels[0];
  assert.equal(f.store.read().sessions[sid].state,'UNKNOWN');const native=await f.adapter.readNative(sid);assert.ok(native.events.some(row=>row.type==='assistant/message'));
  let calls=0;f.adapter.stopResources=async()=>{calls++;};const before=f.store.read().groups[g.groupId];
  const receipt=await stop(f,g,r);assert.deepEqual(receipt,{groupId:g.groupId,roundId:r.roundId,accepted:false,state:'complete',settled:false,channels:[sid]});
  assert.deepEqual(f.store.read().groups[g.groupId],before);assert.equal(calls,0);
  const b=await f.bot('B'),valid=await f.group('TerminalKnown',[b]),validRound=await post(f,valid,'valid-complete');await eventually(()=>round(f,valid,validRound).state==='complete');
  const validReceipt=await stop(f,valid,validRound,'valid-noop');assert.equal(validReceipt.accepted,false);assert.equal(validReceipt.settled,true);assert.equal(calls,0);
});

// Durable stopped proof is usable only for the exact original session IDs.
test('v1.3 stopped terminal settlement accepts exact durable proof and refuses mismatched proof without cancellation',async t=>{
  const f=await held(t);await stop(f,f.g,f.r);await eventually(()=>round(f,f.g,f.r).state==='stopped');
  const sid=round(f,f.g,f.r).channels[0],resources=f.adapter.resources.bind(f.adapter);let calls=0;
  f.adapter.resources=id=>id===sid?{known:false,settled:false}:resources(id);f.adapter.stopResources=async()=>{calls++;};
  const valid=await stop(f,f.g,f.r,'durable-valid');assert.equal(valid.accepted,false);assert.equal(valid.settled,true);
  await f.store.transact(command('mismatched-proof','fixture',{}),draft=>{draft.groups[f.g.groupId].rounds[f.r.roundId].stopEvidence[0].sessionId='unrelated-original-id';return null;});
  const mismatched=await stop(f,f.g,f.r,'durable-mismatch');assert.equal(mismatched.accepted,false);assert.equal(mismatched.settled,false);assert.equal(calls,0);
});

test('v1.3 unknown and previous-runtime rounds refuse stop without replaying resources',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('A'),g=await f.group('Unknown',[a]);let calls=0;
  f.adapter.stopResources=async()=>{calls++;};
  for(const [id,state,runtimeId] of [['unknown','UNKNOWN',f.tasks.runtimeId],['foreign-runtime','running','old-runtime']]) {
    await f.store.transact(command(`fixture-${id}`,'fixture',{}),draft=>{draft.groups[g.groupId].rounds[id]={roundId:id,groupId:g.groupId,state,runtimeId,channels:[],requests:2,absences:[]};return null;});
    await assert.rejects(stop(f,g,{roundId:id},`stop-${id}`),{code:'round_outcome_unknown'});
    assert.equal(round(f,g,{roundId:id}).state,state);assert.equal(calls,0);assert.equal(f.store.read().operations[`stop-${id}`],undefined);
  }
});

test('v1.3 known unsettled resources keep stopping and block queue and Bot deletion until proof arrives',async t=>{
  const f=await held(t),resources=f.adapter.resources.bind(f.adapter);let heldProof=true;
  f.adapter.resources=sid=>{const proof=resources(sid);return sid===round(f,f.g,f.r).channels[0]&&heldProof?{...proof,settled:false}:proof;};
  await stop(f,f.g,f.r);await eventually(()=>f.requests[0].signal.aborted);await tick();assert.equal(round(f,f.g,f.r).state,'stopping');
  await f.store.transact(command('queue-fixture','fixture',{}),draft=>{for(let i=0;i<7;i++)draft.groups[f.g.groupId].rounds[`pending-${i}`]={state:'UNKNOWN',runtimeId:'previous',channels:[]};return null;});
  await assert.rejects(post(f,f.g,'full'),{code:'group_queue_full'});
  await assert.rejects(f.bots.delete(f.human,command('delete','bot.delete',{botId:f.b.botId,expectedVersion:f.b.revision})),{code:'bot_tasks_unsettled'});
  heldProof=false;await eventually(()=>round(f,f.g,f.r).state==='stopped');
});

// Without change detection a stopping round writes the same proof indefinitely.
test('v1.3 unchanged pending settlement observations do not create durable operations',async t=>{
  const f=await held(t),resources=f.adapter.resources.bind(f.adapter);let pending=true;
  f.adapter.resources=sid=>{const proof=resources(sid);return sid===round(f,f.g,f.r).channels[0]&&pending?{...proof,settled:false}:proof;};
  await stop(f,f.g,f.r);await eventually(()=>round(f,f.g,f.r).stopEvidence?.length===1);
  const before=f.store.read().revision;
  await new Promise(resolve=>setTimeout(resolve,170));
  assert.equal(f.store.read().revision,before,'unchanged resource observations are read-only');
  pending=false;await eventually(()=>round(f,f.g,f.r).state==='stopped');
});

// Changing current membership cannot make a prior stopping channel deletable.
test('v1.3 a removed member retains its stopping lifecycle blocker when native resources are unknown',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('A'),b=await f.bot('B'),g=await f.group('RemovedStop',[a,b]),r=await post(f,g);
  await eventually(()=>round(f,g,r).state==='complete');const sid=round(f,g,r).channels[0];
  await f.store.transact(command('stopping-removed-fixture','fixture',{}),draft=>{
    const group=draft.groups[g.groupId];group.members.find(row=>row.botId===a.botId).active=false;group.ownerBotId=b.botId;group.coordinatorBotId=b.botId;
    group.rounds[r.roundId].state='stopping';draft.sessions[sid].state='stopping';return null;
  });
  const resources=f.adapter.resources.bind(f.adapter);f.adapter.resources=id=>id===sid?{known:false,settled:false}:resources(id);
  const before=f.store.read();
  await assert.rejects(f.bots.delete(f.human,command('removed-delete','bot.delete',{botId:a.botId,expectedVersion:a.revision})),{code:'bot_contact_unsettled'});
  assert.deepEqual(f.store.read(),before);
});

for(const failure of ['unknown','fault','throw','dispose'])test(`v1.3 ${failure} resource proof preserves UNKNOWN and original IDs`,async t=>{
  let f,resources,realStop,dispose;
  t.after(()=>{f.adapter.resources=resources;f.adapter.stopResources=realStop;f.adapter.disposeOwned=dispose;});
  f=await held(t);const sid=round(f,f.g,f.r).channels[0];resources=f.adapter.resources.bind(f.adapter);realStop=f.adapter.stopResources.bind(f.adapter);dispose=f.adapter.disposeOwned.bind(f.adapter);
  if(failure==='unknown')f.adapter.resources=id=>id===sid?{known:false,settled:false}:resources(id);
  if(failure==='fault')f.adapter.resources=id=>id===sid?{...resources(id),settled:false,resourceFaults:[{error:'controlled-resource-fault'}]}:resources(id);
  if(failure==='throw')f.adapter.stopResources=async id=>{await realStop(id);throw Object.assign(Error('Stop failure'),{code:'controlled-stop-failure'});};
  if(failure==='dispose')f.adapter.disposeOwned=async()=>{throw Object.assign(Error('Disposal failure'),{code:'controlled-dispose-failure'});};
  await stop(f,f.g,f.r);if(failure==='unknown')f.gate.resolve();
  await eventually(()=>round(f,f.g,f.r).state==='UNKNOWN');
  assert.deepEqual(round(f,f.g,f.r).channels,[sid]);assert.equal(round(f,f.g,f.r).requests,1);
  assert.equal(f.store.read().operations.post.result.roundId,f.r.roundId);assert.equal(f.store.read().sessions[sid].state,'UNKNOWN');
});

test('v1.3 restart maps durable stopping to UNKNOWN and replay never creates or stops old work',async t=>{
  const f=await collaborationFixture(t),a=await f.bot('A'),g=await f.group('Restart',[a]),r=await post(f,g);
  await eventually(()=>round(f,g,r).state==='complete');
  const c=command('old-stop','group.round.stop',{groupId:g.groupId,roundId:r.roundId});
  await f.store.transact(f.policy.command(f.human,c),draft=>{const row=draft.groups[g.groupId].rounds[r.roundId];row.state='stopping';row.runtimeId='old-runtime';draft.sessions[row.channels[0]].ownerRuntimeId='old-adapter';draft.sessions[row.channels[0]].state='stopping';return {groupId:g.groupId,roundId:r.roundId,accepted:true,state:'stopping',settled:false,channels:row.channels};});
  const controller=new GroupMeetingController(f),recovery=new Reconciler(f);let calls=0;
  f.adapter.stopResources=async()=>{calls++;};
  const result=await recovery.reconcile(f.human,command('restart','recovery.reconcile',{}));
  assert.deepEqual(result.unknown,[r.roundId]);assert.equal(result.replayed,0);assert.equal(result.released,0);
  const before=f.store.read(),count=f.requests.length;
  await controller.stopRound(f.human,c);await controller.post(f.human,command('post','group.post',{groupId:g.groupId,text:'post'}));await tick();
  assert.equal(calls,0);assert.equal(f.requests.length,count);assert.equal(round(f,g,r).state,'UNKNOWN');
  assert.equal(f.store.read().sessions[round(f,g,r).channels[0]].state,'UNKNOWN');assert.deepEqual(f.store.read().groups,before.groups);
});

// Only a fresh official runtime proves missing native handles cannot settle or replay.
test('v1.3 actual fresh-process restart retains original stopping intent and channels with zero replay',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'v130-stopping-restart-'));
  const script=`
    import {collaborationFixture} from './test/native-plugin/collaboration-fixture.mjs';
    import {eventually} from './test/native-plugin/official-fixture.mjs';
    const directory=process.argv[1],f=await collaborationFixture({after(){}},{directory,stream:async function*(){await new Promise(()=>{});}}),a=await f.bot('RestartA'),b=await f.bot('RestartB'),g=await f.group('ActualRestart',[a,b]);
    const start={operationId:'original-post',action:'group.post',input:{groupId:g.groupId,text:'Persist original work'}};
    const intent=await f.service.dispatch(f.human,start);await eventually(()=>f.requests.length===1);
    const stop={operationId:'original-stop',action:'group.round.stop',input:{groupId:g.groupId,roundId:intent.roundId}};
    const receipt=await f.service.dispatch(f.human,stop);
    console.log('STOPPING_PREFIX '+JSON.stringify({start,stop,intent,receipt,group:f.store.read().groups[g.groupId],operations:f.store.read().operations}));process.exit(0);
  `;
  const output=execFileSync(process.execPath,['--input-type=module','-e',script,directory],{cwd:new URL('../../',import.meta.url),encoding:'utf8',timeout:10000});
  const prefix=JSON.parse(output.split('\n').find(line=>line.startsWith('STOPPING_PREFIX ')).slice('STOPPING_PREFIX '.length));
  const f=await collaborationFixture(t,{directory});t.after(()=>rm(directory,{recursive:true,force:true}));
  const before=f.store.read(),saved=before.groups[prefix.group.groupId].rounds[prefix.intent.roundId];
  assert.equal(saved.state,'stopping');assert.equal(saved.requests,1);assert.equal(saved.channels.length,1);
  assert.deepEqual(before.operations['original-post'],prefix.operations['original-post']);assert.deepEqual(before.operations['original-stop'],prefix.operations['original-stop']);
  const resource=f.adapter.resources(saved.channels[0]);assert.equal(resource.known,false);assert.equal(resource.settled,false);
  const result=await f.recovery.reconcile(f.human,command('actual-restart','recovery.reconcile',{}));
  assert.ok(result.unknown.includes(saved.roundId));assert.equal(result.replayed,0);assert.equal(result.released,0);
  assert.deepEqual(await f.service.dispatch(f.human,prefix.stop),prefix.receipt);
  assert.deepEqual(await f.service.dispatch(f.human,prefix.start),prefix.intent);
  await tick();const after=f.store.read().groups[prefix.group.groupId].rounds[saved.roundId];
  assert.equal(after.state,'UNKNOWN');assert.deepEqual(after.channels,saved.channels);assert.equal(after.requests,1);assert.equal(f.requests.length,0);
  await assert.rejects(stop(f,prefix.group,prefix.intent,'new-stop-after-restart'),{code:'round_outcome_unknown'});
});

// Cap checks outside the reservation transaction lose this concurrent last slot.
test('v1.3 history cap fences a channel reservation queued before history reached 2000',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await collaborationFixture(t),a=await f.bot('A'),g=await f.group('CapAdmission',[a]),transact=f.store.transact.bind(f.store);let entered=false;
  f.store.transact=async(c,mutate)=>{if(c.action==='group.channel'){entered=true;await gate.promise;}return transact(c,mutate);};
  const r=await post(f,g);await eventually(()=>entered);await seedHistory(f,g,2000);const original=JSON.stringify(f.store.read().groups[g.groupId].messages);
  gate.resolve();await eventually(()=>round(f,g,r).state==='complete','uncapped baseline reservation',120000);
  assert.equal(f.requests.length,0);assert.deepEqual(round(f,g,r).channels,[]);
  assert.ok(round(f,g,r).absences.some(row=>row.reason==='group_history_full'));
  assert.equal(JSON.stringify(f.store.read().groups[g.groupId].messages),original);
});

// The human append can fill the last slot while an older model reply is in flight.
test('v1.3 original 1999 messages plus human post preserve a full history and the inflight native reply',async t=>{
  const f=await held(t);await seedHistory(f,f.g,1999);const original=JSON.stringify(f.store.read().groups[f.g.groupId].messages);
  const last=await post(f,f.g,'last-human');f.gate.resolve();
  await eventually(()=>round(f,f.g,f.r).state==='complete'&&round(f,f.g,last).state==='complete','full rounds',120000);
  const group=f.store.read().groups[f.g.groupId],saved=round(f,f.g,f.r),sid=saved.channels[0];
  assert.equal(group.messages.length,2000);assert.equal(JSON.stringify(group.messages.slice(0,1999)),original);
  assert.equal(group.messages.at(-1).messageId,f.store.read().operations['last-human'].result.messageId);
  assert.equal(f.requests.length,1);assert.equal(round(f,f.g,last).requests,0);assert.deepEqual(round(f,f.g,last).channels,[]);
  const absence=saved.absences.find(row=>row.botId===f.a.botId&&row.reason==='group_history_full');assert.ok(absence);
  assert.equal(absence.source.sessionId,sid);assert.equal(absence.usage.length,1);
  const native=await f.adapter.readNative(sid);assert.ok(native.events.some(event=>event.type==='assistant/message'));
  assert.equal(native.events[absence.source.eventSeq].data.message.id,absence.messageId);
  assert.equal(f.store.read().sessions[sid].state,'UNKNOWN');assert.equal(f.adapter.resources(sid).settled,true);
});

// Two independently completed native turns must atomically compete for one slot.
test('v1.3 two inflight rounds competing for the final history slot retain both native results',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const f=await collaborationFixture(t,{stream:async function*(options){await waitSignal(options,gate);yield*textChunks('Authentic last-slot reply');}}),a=await f.bot('A'),g=await f.group('Competing',[a]);
  const first=await post(f,g,'first-round'),second=await post(f,g,'second-round');await eventually(()=>f.requests.length===2);
  await seedHistory(f,g,1999);const original=JSON.stringify(f.store.read().groups[g.groupId].messages);
  gate.resolve();await eventually(()=>round(f,g,first).state==='complete'&&round(f,g,second).state==='complete','competing rounds',120000);
  const group=f.store.read().groups[g.groupId],replies=group.messages.filter(row=>row.producer.kind==='bot');
  assert.equal(group.messages.length,2000);assert.equal(replies.length,1);assert.equal(JSON.stringify(group.messages.slice(0,1999)),original);
  const rounds=[round(f,g,first),round(f,g,second)],failed=rounds.find(row=>row.absences.some(absence=>absence.reason==='group_history_full'));
  assert.ok(failed);assert.equal(rounds.filter(row=>row.absences.length===0).length,1);assert.equal(f.requests.length,2);
  for(const row of rounds){assert.equal(row.requests,1);assert.equal(row.channels.length,1);const native=await f.adapter.readNative(row.channels[0]);assert.ok(native.events.some(event=>event.type==='assistant/message'));}
  assert.equal(replies[0].source.sessionId,rounds.find(row=>row.roundId!==failed.roundId).channels[0]);assert.equal(replies[0].usage.length,1);
  assert.equal(f.store.read().sessions[failed.channels[0]].state,'UNKNOWN');assert.equal(f.adapter.resources(failed.channels[0]).settled,true);
});

// Migrated overlimit history remains intact; only new appends are rejected.
test('v1.3 preexisting overlimit group history remains byte-identical after an inflight reply and rejected post',async t=>{
  const f=await held(t);await seedHistory(f,f.g,2001);const original=JSON.stringify(f.store.read().groups[f.g.groupId].messages);
  await assert.rejects(post(f,f.g,'overlimit-human'),{code:'group_history_full'});
  f.gate.resolve();await eventually(()=>round(f,f.g,f.r).state==='complete','overlimit round',120000);
  const saved=round(f,f.g,f.r);assert.equal(JSON.stringify(f.store.read().groups[f.g.groupId].messages),original);
  assert.equal(f.requests.length,1);assert.equal(saved.channels.length,1);assert.equal(saved.requests,1);
  assert.equal(f.store.read().operations['overlimit-human'],undefined);assert.ok(saved.absences.some(row=>row.reason==='group_history_full'));
  const native=await f.adapter.readNative(saved.channels[0]);assert.ok(native.events.some(event=>event.type==='assistant/message'));
  assert.equal(f.store.read().sessions[saved.channels[0]].state,'UNKNOWN');assert.equal(f.adapter.resources(saved.channels[0]).settled,true);
});
