import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {brokerFixture} from './broker-fixture.mjs';
import {createOfficialFixture, deferred, eventually, textChunks} from './official-fixture.mjs';
import {PluginStore} from '../../src/native/store.mjs';
import {PermissionPolicy} from '../../src/native/policy.mjs';
import {NativeDshAdapter} from '../../src/native/adapter.mjs';
import {BotDirectory} from '../../src/native/bots.mjs';
import {SessionOwnership} from '../../src/native/sessions.mjs';
import {BotService} from '../../src/native/service.mjs';
import {GroupMeetingController} from '../../src/native/collaboration.mjs';
import {Reconciler} from '../../src/native/recovery.mjs';

const command=(action,bot,operationId=action)=>({operationId,action,input:{botId:bot.botId,expectedVersion:bot.revision}});
const dispatch=(f,action,bot,operationId)=>f.service.dispatch(f.human,command(action,bot,operationId));
async function seed(f,input,mutate) {
  return f.store.transact({operationId:crypto.randomUUID(),action:'fixture.seed',input},mutate);
}
async function delayedPersistenceFixture(t) {
  const native=await createOfficialFixture(),gate={delay:false,fail:false,entered:deferred(),release:deferred()},
    kv=native.ctx.storage.backend.get('json').kv,
    store=await PluginStore.open({async open(options) {
      const unit=await kv.open(options);
      return {loadAll:()=>unit.loadAll(),close:()=>unit.close(),async putRecord(...args) {
        if(gate.delay) {gate.entered.resolve();await gate.release.promise;}
        if(gate.fail)throw gate.fail===true?Object.assign(new Error('Controlled durable storage failure'),{code:'fixture_storage_failed'}):gate.fail;
        return unit.putRecord(...args);
      }};
    }}),operator={},policy=new PermissionPolicy(store,{agents:native.ctx.agents,operatorPeer:operator}),
    human=policy.fromPeer(operator),adapter=new NativeDshAdapter(native.ctx,{store,policy}),
    bots=new BotDirectory(store,policy,adapter),sessions=new SessionOwnership(store,policy,adapter),
    service=new BotService({store,policy,adapter,bots,sessions});
  adapter.setService(service);
  t.after(async()=>{gate.release.resolve();await adapter.close();await store.close();await native.close();});
  const bot=await bots.create(human,{operationId:'create',action:'bot.create',input:{name:'A',cwd:native.dir,contact:{provider:'controlled',model:'model-a'}}}),
    contact=await sessions.create(human,{operationId:'contact',action:'session.create',input:{botId:bot.botId}});
  return {...native,gate,store,policy,human,adapter,bots,sessions,service,bot,contact};
}
async function modelFreeCollaborationFixture(t) {
  let disk;
  const store=await PluginStore.open({async open(){return {
    loadAll:async()=>({tables:{state:disk?{current:disk}:{}},global:null}),
    putRecord:async(_table,_key,value)=>{disk=structuredClone(value);},close:async()=>{},
  };}}),agents=new Map(),operator={},policy=new PermissionPolicy(store,{agents,operatorPeer:operator}),human=policy.fromPeer(operator),
    gate={botId:null,entered:deferred(),release:deferred()};
  agents.withoutInitiator=async operation=>operation();
  const adapter={runtimeId:'model-free-runtime',context:{agents,get:()=>undefined,sessions:{flush:async()=>{}}},
    setContextProvider(){},validateLocation:async value=>value,validateModel:async value=>value,validatePreset:async value=>value??null,fenceBotAdmissions:()=>()=>{},
    resources:sessionId=>({known:agents.has(sessionId),settled:agents.has(sessionId),requests:[]}),
    async createOwned(binding) {
      if(binding.botId===gate.botId) {gate.entered.resolve(binding);await gate.release.promise;throw Object.assign(new Error('Fixture closes pending channel'),{code:'fixture_channel_closed'});}
      const agent={id:binding.sessionId,session:{id:binding.sessionId},status:'idle',inbox:{nextTurn:[],nextStep:[]},followup(){},whenIdle:async()=>{}};
      agents.set(agent.id,agent);return {agent};
    },disposeOwned:async sessionId=>{agents.delete(sessionId);},stopResources:async()=>{},
    readNative:async()=>({events:[{seq:1,type:'assistant/message',data:{message:{source:{kind:'model'},content:[{type:'text',text:'Fixture opinion evidence'}]}}},
      {seq:2,type:'turn/end',data:{reason:{kind:'completed'}}}]}),
  },bots=new BotDirectory(store,policy,adapter),tasks={runtimeId:'model-free-tasks'},
    collaboration=new GroupMeetingController({store,policy,adapter,tasks}),recovery=new Reconciler({store,policy,adapter,tasks}),
    service=new BotService({store,policy,adapter,bots,collaboration});
  t.after(async()=>{gate.release.resolve();await collaboration.close();await store.close();});
  return {store,policy,human,adapter,bots,tasks,collaboration,recovery,service,gate,
    bot:name=>bots.create(human,{operationId:`create-${name}`,action:'bot.create',input:{name,cwd:'/workspace',contact:{provider:'fixture',model:'fixture'}}})};
}

test('Bot deletion is a recoverable tombstone preserving native history and owned records',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),contact=await f.contact(bot),task=await f.task(bot),
    memory=await f.bots.memoryWrite(f.human,{operationId:'memory',action:'memory.write',input:{botId:bot.botId,text:'Keep this fact'}}),
    agent=f.ctx.agents.get(contact.sessionId);
  agent.inbox.append('next-turn',createUserMessage({content:[{type:'text',text:'Recorded history without a model call'}],source:{kind:'user'}}));
  agent.inbox.clear();await f.ctx.sessions.flush(agent.session);
  await seed(f,{},draft=>{
    draft.attempts.settled={attemptId:'settled',taskId:task.taskId,botId:bot.botId,state:'returned',reservationHeld:false,sessionId:contact.sessionId};
    draft.outbox.delivered={outboxId:'delivered',botId:bot.botId,sessionId:contact.sessionId,state:'accepted'};
    return null;
  });
  const history=await f.sessions.page(f.human,{sessionId:contact.sessionId}),before=f.store.read();
  const deleted=await dispatch(f,'bot.delete',bot);
  assert.equal(deleted.botId,bot.botId);assert.equal(deleted.lifecycle,'archived');assert.ok(Number.isFinite(Date.parse(deleted.deletedAt)));
  assert.equal(deleted.revision,bot.revision+1);assert.equal(deleted.epoch,bot.epoch+1);assert.equal(deleted.configRevision,bot.configRevision);
  for(const table of ['sessions','memories','tasks','attempts','outbox','grants','groups','meetings'])assert.deepEqual(f.store.read()[table],before[table]);
  for(const [id,receipt] of Object.entries(before.operations))assert.deepEqual(f.store.read().operations[id],receipt);
  assert.deepEqual(await f.sessions.page(f.human,{sessionId:contact.sessionId}),history);
  assert.equal(f.service.snapshot(f.human).bots.find(row=>row.botId===bot.botId).deletedAt,deleted.deletedAt);
  assert.equal(f.bots.searchMemory(f.human,{botId:bot.botId})[0].memoryId,memory.memoryId);
  assert.equal((await f.sessions.list(f.human)).items.find(row=>row.sessionId===contact.sessionId).botId,bot.botId);
  assert.equal(f.ctx.agents.get(contact.sessionId),agent);assert.equal(f.requests.length,0);
});

test('delete and restore retries return original receipts and keep the same paused identity',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),deleteCommand=command('bot.delete',bot,'delete-once');
  const [deleted,duplicate]=await Promise.all([f.service.dispatch(f.human,deleteCommand),f.service.dispatch(f.human,deleteCommand)]);
  assert.deepEqual(duplicate,deleted);
  const restoreCommand=command('bot.restore',deleted,'restore-once'),restored=await f.service.dispatch(f.human,restoreCommand);
  assert.equal(restored.botId,bot.botId);assert.equal(restored.lifecycle,'paused');assert.equal(Object.hasOwn(restored,'deletedAt'),false);
  assert.equal(restored.revision,deleted.revision+1);assert.equal(restored.epoch,deleted.epoch+1);
  const beforeRetry=f.store.read();
  assert.deepEqual(await f.service.dispatch(f.human,deleteCommand),deleted);
  assert.deepEqual(await f.service.dispatch(f.human,restoreCommand),restored);assert.deepEqual(f.store.read(),beforeRetry);
  await assert.rejects(f.sessions.create(f.human,{operationId:'paused-contact',action:'session.create',input:{botId:restored.botId}}),{code:'bot_not_active'});
  const active=await f.bots.update(f.human,{operationId:'activate',action:'bot.update',input:{botId:restored.botId,expectedVersion:restored.revision,lifecycle:'active'}});
  assert.equal((await f.contact(active,'restored-contact')).botId,bot.botId);assert.equal(f.requests.length,0);
});

test('a committed human update replays its original receipt after deletion without changing the tombstone',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),contact=await f.contact(bot),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId)),
    request={operationId:'rename-receipt',action:'bot.update',input:{botId:bot.botId,expectedVersion:bot.revision,name:'Renamed'}},
    renamed=await f.service.dispatch(f.human,request);
  await dispatch(f,'bot.delete',renamed);const before=f.store.read();
  assert.deepEqual(await f.service.dispatch(f.human,request),renamed);
  await assert.rejects(f.service.dispatch(f.human,{...request,input:{...request.input,name:'Changed request'}}),{code:'operation_conflict'});
  await assert.rejects(f.service.dispatch(actor,request),{code:'access_denied'});
  await assert.rejects(f.bots.update({kind:'human'},request),{code:'access_denied'});
  assert.deepEqual(f.store.read(),before);assert.equal(f.requests.length,0);
});

test('delete and restore reject stale revisions and malformed inputs without recording operations',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),changed=await f.bots.update(f.human,{operationId:'rename',action:'bot.update',input:{botId:bot.botId,expectedVersion:bot.revision,name:'Renamed'}});
  const before=f.store.read();
  await assert.rejects(dispatch(f,'bot.delete',bot,'stale-delete'),{code:'revision_conflict'});
  for(const [index,input] of [{botId:bot.botId},{botId:bot.botId,expectedVersion:changed.revision,eraseHistory:true},{botId:bot.botId,expectedVersion:'2'}].entries()) {
    await assert.rejects(f.service.dispatch(f.human,{operationId:`invalid-delete-${index}`,action:'bot.delete',input}),{code:'invalid_input'});
  }
  await assert.rejects(dispatch(f,'bot.restore',changed,'not-deleted'),{code:'bot_not_deleted'});assert.deepEqual(f.store.read(),before);
  const deleted=await dispatch(f,'bot.delete',changed);
  const afterDelete=f.store.read();
  await assert.rejects(dispatch(f,'bot.restore',changed,'stale-restore'),{code:'revision_conflict'});
  await assert.rejects(dispatch(f,'bot.delete',deleted,'delete-twice'),{code:'bot_deleted'});assert.deepEqual(f.store.read(),afterDelete);
});

test('known deletion precondition rejections identify that no write occurred',async t=>{
  for(const mode of ['invalid-delete','invalid-restore','stale-delete','stale-restore','not-found','bot-deleted','bot-not-deleted','task','delivery','session-unknown','contact-queue'])await t.test(mode,async t=>{
    const f=await brokerFixture(t),bot=await f.bot(),contact=await f.contact(bot);
    let request=command('bot.delete',bot,`precondition-${mode}`),code;
    if(mode.startsWith('invalid-')) {request.action=mode==='invalid-delete'?'bot.delete':'bot.restore';delete request.input.expectedVersion;code='invalid_input';}
    else if(mode.startsWith('stale-')) {request.input.expectedVersion=0;code='invalid_input';}
    else if(mode==='not-found') {request.input.botId='missing';code='not_found';}
    else if(mode==='bot-deleted') {request=command('bot.delete',await dispatch(f,'bot.delete',bot),'delete-again');code='bot_deleted';}
    else if(mode==='bot-not-deleted') {request.action='bot.restore';code='bot_not_deleted';}
    else if(mode==='contact-queue') {f.ctx.agents.get(contact.sessionId).inbox.append('next-turn',createUserMessage({content:[{type:'text',text:'Pending'}]}));code='bot_contact_active';}
    else await seed(f,{mode},draft=>{
      if(mode==='task') {draft.tasks.unknown={taskId:'unknown',botId:bot.botId,state:'UNKNOWN'};code='bot_tasks_unsettled';}
      else if(mode==='delivery') {draft.outbox.unknown={outboxId:'unknown',botId:bot.botId,state:'UNKNOWN'};code='bot_delivery_pending';}
      else {draft.sessions[contact.sessionId].state='UNKNOWN';code='bot_contact_unsettled';}
      return null;
    });
    if(mode.startsWith('stale-')) {
      const changed=await f.bots.update(f.human,{operationId:'new-version',action:'bot.update',input:{botId:bot.botId,expectedVersion:bot.revision,name:'Updated'}});
      if(mode==='stale-restore') {await dispatch(f,'bot.delete',changed);request.action='bot.restore';}
      request.input.expectedVersion=bot.revision;code='revision_conflict';
    }
    const before=f.store.read();
    await assert.rejects(f.service.dispatch(f.human,request),error=>{assert.equal(error.code,code);assert.equal(error.details?.rejectedBeforeWrite,true);return true;});
    assert.deepEqual(f.store.read(),before);assert.equal(f.requests.length,0);
  });
});

test('a storage failure with a precondition-shaped code remains an uncertain deletion outcome',async t=>{
  const f=await delayedPersistenceFixture(t),failure=Object.assign(new Error('Storage write acknowledgement failed'),{code:'revision_conflict'}),before=f.store.read();
  f.gate.fail=failure;
  await assert.rejects(dispatch(f,'bot.delete',f.bot,'failed-precondition-shaped-storage'),error=>{
    assert.equal(error,failure);assert.equal(error.details?.rejectedBeforeWrite,undefined);return true;
  });
  assert.deepEqual(f.store.read({diagnostic:true}),before);const release=f.adapter.fenceBotAdmissions(f.bot.botId);release();assert.equal(f.requests.length,0);
});

test('an error after committed deletion never claims that the operation was rejected before write',async t=>{
  const f=await delayedPersistenceFixture(t),controller=new AbortController(),request=command('bot.delete',f.bot,'committed-aborted-return');
  f.gate.delay=true;
  const rejected=assert.rejects(f.service.dispatch(f.human,request,controller.signal),error=>{
    assert.equal(error.code,'revision_conflict');assert.equal(error.details?.rejectedBeforeWrite,undefined);return true;
  });
  await f.gate.entered.promise;controller.abort(Object.assign(new Error('Caller aborted after admission'),{code:'revision_conflict'}));
  f.gate.release.resolve();await rejected;
  assert.ok(f.store.read().bots[f.bot.botId].deletedAt);assert.equal(f.store.read().operations[request.operationId].action,'bot.delete');assert.equal(f.requests.length,0);
});

test('deleted Bot cannot be revived by update or admit new sessions, messages or task work',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),contact=await f.contact(bot),task=await f.task(bot),deleted=await dispatch(f,'bot.delete',bot),before=f.store.read();
  for(const request of [
    {operationId:'bypass-update',action:'bot.update',input:{botId:bot.botId,expectedVersion:deleted.revision,lifecycle:'active'}},
    {operationId:'bypass-session',action:'session.create',input:{botId:bot.botId}},
    {operationId:'bypass-send',action:'session.send',input:{sessionId:contact.sessionId,text:'Wake up'}},
    {operationId:'bypass-start',action:'task.start',input:{taskId:task.taskId,expectedVersion:task.version}},
  ])await assert.rejects(f.service.dispatch(f.human,request),{code:'bot_deleted'});
  assert.deepEqual(f.store.read(),before);assert.equal(f.requests.length,0);
});

test('Bots cannot delete or restore themselves or others even with control grants',async t=>{
  const f=await brokerFixture(t),a=await f.bot('A'),b=await f.bot('B'),contact=await f.contact(a),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  await f.policy.authorizeShare(f.human,{operationId:'control',action:'grant.set',input:{grantId:'control',recipientBotId:a.botId,ownerBotId:b.botId,scope:{sessions:['*'],tasks:['*']},level:'control',active:true}});
  const before=f.store.read();
  for(const bot of [a,b])for(const action of ['bot.delete','bot.restore'])await assert.rejects(f.service.dispatch(actor,command(action,bot,`${action}-${bot.name}`)),{code:'access_denied'});
  assert.deepEqual(f.store.read(),before);
  const deleted=await dispatch(f,'bot.delete',b);
  await assert.rejects(f.service.dispatch(actor,command('bot.restore',deleted,'restore-other')),{code:'access_denied'});assert.equal(f.requests.length,0);
});

test('delete rejects held or UNKNOWN tasks and attempts atomically',async t=>{
  for(const mode of ['held','task-unknown','attempt-unknown'])await t.test(mode,async t=>{
    const f=await brokerFixture(t),bot=await f.bot(),task=await f.task(bot);
    await seed(f,{mode},draft=>{
      if(mode==='task-unknown')draft.tasks[task.taskId].state='UNKNOWN';
      else draft.attempts.work={attemptId:'work',botId:bot.botId,taskId:task.taskId,state:mode==='held'?'running':'UNKNOWN',reservationHeld:mode==='held'};
      return null;
    });
    const before=f.store.read();await assert.rejects(dispatch(f,'bot.delete',bot),{code:'bot_tasks_unsettled'});
    assert.deepEqual(f.store.read(),before);assert.equal(f.requests.length,0);
  });
});

test('delete rechecks owned work inside the queued transaction',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),task=await f.task(bot);
  const admission=seed(f,{},draft=>{
    draft.attempts.work={attemptId:'work',botId:bot.botId,taskId:task.taskId,state:'starting',reservationHeld:true};return null;
  });
  const rejection=assert.rejects(dispatch(f,'bot.delete',bot,'race-delete'),{code:'bot_tasks_unsettled'});await admission;
  const before=f.store.read();await rejection;assert.deepEqual(f.store.read(),before);
});

test('delete rejects native outbox admission and pending child results without erasing UNKNOWN',async t=>{
  for(const mode of ['queued','admitting','UNKNOWN','blocked-uncertain','foreign-target','child-result'])await t.test(mode,async t=>{
    const f=await brokerFixture(t),bot=await f.bot(),contact=await f.contact(bot),task=await f.task(bot);
    await seed(f,{mode},draft=>{
      draft.outbox.pending={outboxId:'pending',botId:mode==='foreign-target'?'other':bot.botId,sessionId:contact.sessionId,state:mode==='blocked-uncertain'?'blocked':mode==='foreign-target'||mode==='child-result'?'queued':mode,...(mode==='blocked-uncertain'?{nativeAdmission:true}:{})};
      if(mode==='child-result') {
        draft.attempts.parent={attemptId:'parent',botId:bot.botId,taskId:task.taskId,state:'returned',reservationHeld:false,sessionId:'parent-session'};
        draft.attempts.child={attemptId:'child',botId:'other',taskId:'other-task',parentAttemptId:'parent',state:'returned',reservationHeld:false,resultOutboxId:'pending'};
        draft.outbox.pending.botId='other';draft.outbox.pending.sessionId='parent-session';
      }
      return null;
    });
    const before=f.store.read();await assert.rejects(dispatch(f,'bot.delete',bot),{code:'bot_delivery_pending'});
    assert.deepEqual(f.store.read(),before);assert.equal(f.requests.length,0);
  });
});

test('delete rejects a held child of an owned attempt even when the child belongs to another Bot',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),task=await f.task(bot);
  await seed(f,{},draft=>{
    draft.attempts.parent={attemptId:'parent',botId:bot.botId,taskId:task.taskId,state:'returned',reservationHeld:false};
    draft.attempts.child={attemptId:'child',botId:'other',taskId:'other-task',parentAttemptId:'parent',state:'running',reservationHeld:true};return null;
  });
  const before=f.store.read();await assert.rejects(dispatch(f,'bot.delete',bot),{code:'bot_tasks_unsettled'});assert.deepEqual(f.store.read(),before);
});

test('delete checks native sessions of returned descendants owned by a different Bot',async t=>{
  for(const mode of ['UNKNOWN','queue','resource'])await t.test(mode,async t=>{
    const entered=deferred(),release=deferred();t.after(()=>release.resolve());
    const f=await brokerFixture(t),a=await f.bot('A'),b=await f.bot('B'),parent=await f.contact(a,'parent'),child=await f.contact(b,'child'),
      childAgent=f.ctx.agents.get(child.sessionId);
    await seed(f,{},draft=>{
      draft.attempts.parent={attemptId:'parent',botId:a.botId,state:'returned',reservationHeld:false,sessionId:parent.sessionId};
      draft.attempts.child={attemptId:'child',botId:b.botId,parentAttemptId:'parent',state:'returned',reservationHeld:false,sessionId:child.sessionId};
      if(mode==='UNKNOWN')draft.sessions[child.sessionId].state='UNKNOWN';return null;
    });
    let tool;
    if(mode==='queue')childAgent.inbox.append('next-turn',createUserMessage({content:[{type:'text',text:'Native descendant input'}]}));
    if(mode==='resource') {
      t.after(f.ctx.tools.register({name:'delete_resource_probe',description:'A harmless native owned resource barrier.',parameters:{type:'object'},output:{schema:{type:'boolean'},render:()=>[]},
        async execute(){entered.resolve();await release.promise;return true;}}));
      tool=f.ctx.tools.execute({callId:'descendant-resource',name:'delete_resource_probe',agent:childAgent,arguments:{},signal:new AbortController().signal});
      await entered.promise;assert.equal(f.adapter.resources(child.sessionId).tools,1);assert.equal(childAgent.status,'idle');
    }
    const before=f.store.read();await assert.rejects(dispatch(f,'bot.delete',a),error=>{
      assert.equal(error.code,mode==='UNKNOWN'?'bot_contact_unsettled':'bot_contact_active');assert.equal(error.details?.rejectedBeforeWrite,true);return true;
    });
    assert.deepEqual(f.store.read(),before);assert.equal(f.requests.length,0);release.resolve();if(tool)await tool;
  });
});

test('unrelated Bot native queues and UNKNOWN sessions do not block deletion',async t=>{
  const f=await brokerFixture(t),a=await f.bot('A'),b=await f.bot('B'),contact=await f.contact(b),agent=f.ctx.agents.get(contact.sessionId);
  agent.inbox.append('next-turn',createUserMessage({content:[{type:'text',text:'Unrelated pending input'}]}));
  await seed(f,{},draft=>{draft.sessions[contact.sessionId].state='UNKNOWN';return null;});
  assert.equal((await dispatch(f,'bot.delete',a)).botId,a.botId);assert.equal(f.store.read().sessions[contact.sessionId].state,'UNKNOWN');
  assert.equal(agent.inbox.nextTurn.length,1);assert.equal(f.requests.length,0);
});

test('delete rejects running and recovered UNKNOWN group rounds before its own member channel is created',async t=>{
  for(const state of ['running','UNKNOWN'])for(const relationship of ['coordinator','member'])await t.test(`${state}-${relationship}`,async t=>{
    const f=await modelFreeCollaborationFixture(t),a=await f.bot('A'),b=await f.bot('B');f.gate.botId=b.botId;
    const group=await f.collaboration.createGroup(f.human,{operationId:'group',action:'group.create',input:{name:'Pending bounded work',botIds:[b.botId,a.botId],coordinatorBotId:relationship==='coordinator'?a.botId:b.botId}}),
      round=await f.collaboration.post(f.human,{operationId:'post',action:'group.post',input:{groupId:group.groupId,text:'Start bounded work'}});
    await f.gate.entered.promise;
    if(state==='UNKNOWN') {f.tasks.runtimeId='recovered-tasks';f.adapter.runtimeId='recovered-adapter';await f.recovery.reconcile(f.human,{operationId:'recover',action:'recovery.reconcile',input:{}});}
    const before=f.store.read();assert.equal(before.groups[group.groupId].rounds[round.roundId].state,state);
    assert.equal(Object.values(before.sessions).filter(row=>row.botId===a.botId).length,0);
    await assert.rejects(dispatch(f,'bot.delete',a),error=>{assert.equal(error.code,'bot_tasks_unsettled');assert.equal(error.details?.rejectedBeforeWrite,true);return true;});
    assert.deepEqual(f.store.read(),before);
  });
});

test('delete rejects a nonterminal meeting after its own settled opinion while another channel is pending or UNKNOWN',async t=>{
  for(const state of ['running','UNKNOWN'])for(const relationship of ['coordinator','participant'])await t.test(`${state}-${relationship}`,async t=>{
    const f=await modelFreeCollaborationFixture(t),a=await f.bot('A'),b=await f.bot('B');f.gate.botId=b.botId;
    const group=await f.collaboration.createGroup(f.human,{operationId:'group',action:'group.create',input:{name:'Pending meeting work',botIds:[a.botId,b.botId],coordinatorBotId:relationship==='coordinator'?a.botId:b.botId}}),
      meeting=await f.collaboration.startMeeting(f.human,{operationId:'meeting',action:'meeting.start',input:{groupId:group.groupId,topic:'Open work',materials:''}});
    await f.gate.entered.promise;await eventually(()=>Object.values(f.store.read().sessions).some(row=>row.botId===a.botId&&row.state==='settled'));
    if(state==='UNKNOWN') {f.tasks.runtimeId='recovered-tasks';f.adapter.runtimeId='recovered-adapter';await f.recovery.reconcile(f.human,{operationId:'recover',action:'recovery.reconcile',input:{}});}
    const before=f.store.read();assert.equal(before.meetings[meeting.meetingId].runtimeState,state);assert.ok(before.meetings[meeting.meetingId].opinions[a.botId]);
    await assert.rejects(dispatch(f,'bot.delete',a),error=>{assert.equal(error.code,'bot_tasks_unsettled');assert.equal(error.details?.rejectedBeforeWrite,true);return true;});
    assert.deepEqual(f.store.read(),before);
  });
});

test('dormant groups and completed or cancelled meeting membership remain preserved through deletion and restore',async t=>{
  for(const phase of ['complete','cancelled'])await t.test(phase,async t=>{
    const f=await modelFreeCollaborationFixture(t),a=await f.bot('A'),b=await f.bot('B'),
      group=await f.collaboration.createGroup(f.human,{operationId:'group',action:'group.create',input:{name:'Historical group',botIds:[a.botId,b.botId],coordinatorBotId:a.botId}});
    await seed(f,{phase},draft=>{
      draft.groups[group.groupId].rounds.finished={roundId:'finished',groupId:group.groupId,state:'complete',channels:[]};
      draft.meetings.historical={meetingId:'historical',groupId:group.groupId,ownerBotId:a.botId,coordinatorBotId:a.botId,phase,runtimeState:'running',participants:[{botId:a.botId,active:true},{botId:b.botId,active:true}]};return null;
    });
    const before=f.store.read(),deleted=await dispatch(f,'bot.delete',a),restored=await dispatch(f,'bot.restore',deleted);
    assert.equal(restored.botId,a.botId);assert.equal(restored.lifecycle,'paused');
    assert.deepEqual(f.store.read().groups,before.groups);assert.deepEqual(f.store.read().meetings,before.meetings);
  });
});

test('an unrelated running group and inactive past membership do not block deletion',async t=>{
  for(const pastMember of [false,true])await t.test(pastMember?'inactive past member':'unrelated Bot',async t=>{
    const f=await modelFreeCollaborationFixture(t),a=await f.bot('A'),b=await f.bot('B');f.gate.botId=b.botId;
    const group=await f.collaboration.createGroup(f.human,{operationId:'group',action:'group.create',input:{name:'Other active work',botIds:pastMember?[b.botId,a.botId]:[b.botId],coordinatorBotId:b.botId}});
    await f.collaboration.post(f.human,{operationId:'post',action:'group.post',input:{groupId:group.groupId,text:'Start other work'}});await f.gate.entered.promise;
    if(pastMember)await f.collaboration.changeMembers(f.human,{operationId:'remove-member',action:'group.members',input:{groupId:group.groupId,expectedVersion:f.store.read().groups[group.groupId].version,botIds:[b.botId],coordinatorBotId:b.botId}});
    const before=f.store.read();assert.equal((await dispatch(f,'bot.delete',a)).botId,a.botId);assert.deepEqual(f.store.read().groups,before.groups);
  });
});

test('delete rejects native pending contact input without clearing or waking its queue',async t=>{
  for(const target of ['next-turn','next-step'])await t.test(target,async t=>{
    const f=await brokerFixture(t),bot=await f.bot(),contact=await f.contact(bot),agent=f.ctx.agents.get(contact.sessionId),
      message=createUserMessage({content:[{type:'text',text:'Pending native work'}],source:{kind:'user'}});
    agent.inbox.append(target,message);
    const before=f.store.read();await assert.rejects(dispatch(f,'bot.delete',bot),{code:'bot_contact_active'});
    assert.deepEqual(f.store.read(),before);assert.equal(agent.inbox[target==='next-turn'?'nextTurn':'nextStep'][0].id,message.id);assert.equal(f.requests.length,0);
    agent.inbox.clear();assert.equal((await dispatch(f,'bot.delete',bot)).botId,bot.botId);
  });
});

test('delete rechecks a native contact queue filled after command admission',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),contact=await f.contact(bot),agent=f.ctx.agents.get(contact.sessionId),before=f.store.read();
  const rejection=assert.rejects(dispatch(f,'bot.delete',bot,'queue-race'),{code:'bot_contact_active'}),
    message=createUserMessage({content:[{type:'text',text:'Queued before deletion commits'}],source:{kind:'user'}});
  agent.inbox.append('next-turn',message);await rejection;
  assert.deepEqual(f.store.read(),before);assert.equal(agent.inbox.nextTurn[0].id,message.id);assert.equal(f.requests.length,0);
});

test('delete fences native followup while its durable write is pending and leaves other Bots available',async t=>{
  const f=await delayedPersistenceFixture(t),other=await f.bots.create(f.human,{operationId:'other-bot',action:'bot.create',input:{name:'B',cwd:f.dir,contact:{provider:'controlled',model:'model-b'}}}),
    otherContact=await f.sessions.create(f.human,{operationId:'other-contact',action:'session.create',input:{botId:other.botId}}),
    agent=f.ctx.agents.get(f.contact.sessionId),otherAgent=f.ctx.agents.get(otherContact.sessionId);
  f.gate.delay=true;const deletion=dispatch(f,'bot.delete',f.bot,'slow-delete');await f.gate.entered.promise;
  agent.followup(createUserMessage({content:[{type:'text',text:'Raced with pending deletion'}],source:{kind:'user'}}));
  otherAgent.followup(createUserMessage({content:[{type:'text',text:'Independent Bot remains available'}],source:{kind:'user'}}));
  await Promise.all([agent.whenIdle(),otherAgent.whenIdle()]);
  const ownRequests=f.requests.filter(row=>row.sessionId===agent.id).length,
    foreignRequests=f.requests.filter(row=>row.sessionId===otherAgent.id).length;
  f.gate.release.resolve();await deletion;
  assert.equal(ownRequests,0,'a native turn admitted during a durable deletion write must not request a model');
  assert.equal(foreignRequests,1);assert.equal(f.store.read().bots[other.botId].lifecycle,'active');
  agent.followup(createUserMessage({content:[{type:'text',text:'Also fenced after commit'}],source:{kind:'user'}}));await agent.whenIdle();
  assert.equal(f.requests.filter(row=>row.sessionId===agent.id).length,0);
});

test('failed durable deletion releases its Bot admission fence and preserves the original state',async t=>{
  const f=await delayedPersistenceFixture(t),before=f.store.read();f.gate.fail=true;
  await assert.rejects(dispatch(f,'bot.delete',f.bot,'failed-delete'),{code:'fixture_storage_failed'});
  assert.deepEqual(f.store.read({diagnostic:true}),before);
  const release=f.adapter.fenceBotAdmissions(f.bot.botId);release();
  assert.throws(()=>f.store.read(),{code:'recovery_required'});assert.equal(f.requests.length,0);
});

test('delete rejects a live native reply and never requests its stop',async t=>{
  const release=deferred();t.after(()=>release.resolve());
  const f=await brokerFixture(t,{stream:async function*(){await release.promise;yield* textChunks('Actual native reply');}}),
    bot=await f.bot(),contact=await f.contact(bot),agent=f.ctx.agents.get(contact.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'Reply once'}],source:{kind:'user'}}));await eventually(()=>f.requests.length===1);
  const before=f.store.read();await assert.rejects(dispatch(f,'bot.delete',bot),{code:'bot_contact_active'});
  assert.deepEqual(f.store.read(),before);assert.equal(f.requests[0].signal.aborted,false);
  release.resolve();await agent.whenIdle();assert.equal((await dispatch(f,'bot.delete',bot)).botId,bot.botId);
});

test('public help documents human-only recoverable Bot deletion and restore',async t=>{
  const f=await brokerFixture(t),help=await f.service.dispatch(f.human,{action:'help'});
  for(const action of ['bot.delete','bot.restore']) {
    assert.deepEqual(help.commands[action].required,['botId','expectedVersion']);assert.deepEqual(help.commands[action].optional,[]);
    assert.equal(help.commands[action].humanOnly,true);assert.equal(help.commands[action].readOnly,false);
  }
});
