import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PluginStore, copy, digest} from '../../src/native/store.mjs';
import {PermissionPolicy, defaultShare} from '../../src/native/policy.mjs';
import {createOfficialFixture} from './official-fixture.mjs';

const oldState=()=>({schema:1,storeId:'stable-store',revision:9,...Object.fromEntries(['bots','sessions','memories','grants','tasks','attempts','groups','meetings','operations','outbox'].map(k=>[k,{}]))});
const descriptor={name:'dsh_bot_v1',version:1,tables:['state'],hasGlobal:false,layout:'single'};
async function nativeFixture(t,state) {
  const native=await createOfficialFixture();t.after(()=>native.close());
  const kv=native.ctx.storage.backend.get('json').kv;
  if(state){const unit=await kv.open(descriptor);await unit.putRecord('state','current',state);await unit.close();}
  return {...native,kv};
}
async function policyFixture(t){
  const f=await nativeFixture(t),store=await PluginStore.open(f.kv);t.after(()=>store.close());
  await store.transact({operationId:'seed',action:'seed'},draft=>{
    draft.bots.a={botId:'a',lifecycle:'active',configRevision:1,revision:1};draft.bots.b={botId:'b',lifecycle:'active',configRevision:1,revision:1};
    draft.sessions.sa={sessionId:'sa',botId:'a',purpose:'contact'};draft.sessions.sb={sessionId:'sb',botId:'b',purpose:'contact'};
    draft.tasks.ta={taskId:'ta',botId:'a'};draft.tasks.tb={taskId:'tb',botId:'b'};
    draft.materials.mb={docId:'mb',botId:'b'};return null;
  });
  const operator={},policy=new PermissionPolicy(store,{agents:f.ctx.agents,operatorPeer:operator});
  const handle=await f.ctx.agents.create({sessionId:'sa',agentOptions:{provider:'controlled',model:'model-a'}});
  return {...f,store,policy,human:policy.fromPeer(operator),bot:policy.fromAgent(handle.agent)};
}
test('schema 1 migration preserves identities and operation receipts in one atomic record',async t=>{
  const before=oldState();before.bots.a={botId:'a',share:{enabled:false,receivers:['b'],scope:{sessions:['sa'],memories:['*'],tasks:[]}}};
  before.grants.g={active:true,level:'control',recipientBotId:'a',ownerBotId:null,scope:{sessions:['s']},version:1,grantedBy:'human'};
  before.memories.m={memoryId:'m',text:'old',category:'legacy'};before.tasks.t={taskId:'t',definitionVersion:4};
  before.attempts.x={attemptId:'x',state:'UNKNOWN'};before.outbox.o={outboxId:'o',state:'UNKNOWN'};
  const cmd={operationId:'old-operation',action:'old',input:{a:1}};before.operations[cmd.operationId]={fingerprint:digest(cmd),result:{attemptId:'x'}};
  const f=await nativeFixture(t,before);let writes=0;
  const facet={async open(d){const unit=await f.kv.open(d);return {loadAll:()=>unit.loadAll(),close:()=>unit.close(),putRecord:async(...a)=>{writes++;return unit.putRecord(...a);}};}};
  const store=await PluginStore.open(facet);t.after(()=>store.close());const state=store.read();
  assert.equal(state.schema,2);assert.equal(writes,1);assert.equal(state.revision,9);assert.equal(state.storeId,before.storeId);
  assert.deepEqual(state.migrationBackup,{schema:1,checksum:digest(before),payload:before});
  assert.deepEqual(state.bots.a.share.scope.materials,[]);assert.deepEqual(state.grants.g.scope.materials,[]);
  assert.equal(state.bots.a.memoryRevision,0);assert.equal(state.memories.m.pinned,false);assert.equal(state.memories.m.inactive,false);
  assert.deepEqual(state.tasks.t.dependsOn,[]);assert.deepEqual(state.tasks.t.handoffs,[]);assert.equal(state.tasks.t.definitionVersion,4);
  assert.deepEqual(state.attempts,before.attempts);assert.deepEqual(state.outbox,before.outbox);
  assert.deepEqual(await store.transact(cmd,()=>assert.fail('receipt replayed')),{attemptId:'x'});
});
test('failed migration makes one attempted write and retains exact legacy state',async t=>{
  const before=oldState(),f=await nativeFixture(t,before);let writes=0,closed=false;
  const facet={async open(){return {loadAll:async()=>({tables:{state:{current:before}},global:null}),close:async()=>{closed=true;},putRecord:async()=>{writes++;throw Error('migration disk failure');}};}};
  await assert.rejects(PluginStore.open(facet),/migration disk failure/);assert.equal(writes,1);assert.equal(closed,true);
  const unit=await f.kv.open(descriptor);assert.deepEqual((await unit.loadAll()).tables.state.current,before);await unit.close();
});
test('future and malformed schema do not overwrite official storage',async t=>{
  for(const mutation of [s=>s.schema=999,s=>s.tasks.t=null,s=>s.bots.a={share:{enabled:'bad'}}]){
    const before=oldState();mutation(before);const f=await nativeFixture(t,before);
    const file=join(f.dir,'storage','dsh_bot_v1.json'),bytes=await readFile(file);
    await assert.rejects(PluginStore.open(f.kv));assert.deepEqual(await readFile(file),bytes);
  }
});
test('schema 2 backup checksum and identity are verified before writes',async t=>{
  const before=oldState(),f=await nativeFixture(t,before),store=await PluginStore.open(f.kv);const state=store.read();await store.close();
  assert.equal(state.schema,2);
  for(const mutate of [s=>s.migrationBackup.payload.revision++,s=>s.migrationBackup.payload.storeId='foreign']){
    const corrupt=copy(state);mutate(corrupt);const unit=await f.kv.open(descriptor);await unit.putRecord('state','current',corrupt);await unit.close();
    const file=join(f.dir,'storage','dsh_bot_v1.json'),bytes=await readFile(file);await assert.rejects(PluginStore.open(f.kv),{code:'malformed_state'});assert.deepEqual(await readFile(file),bytes);
  }
});
test('own Bot updates and sessions are allowed; material writes remain owner only',async t=>{
  const f=await policyFixture(t);assert.deepEqual(defaultShare().scope.materials,['*']);
  f.policy.require(f.bot,'bot.update',{kind:'bot',id:'a'});
  for(const action of ['session.configure','session.fork'])f.policy.require(f.bot,action,{kind:'session',id:'sa'});
  assert.throws(()=>f.policy.require(f.bot,'bot.update',{kind:'bot',id:'b'}),{code:'access_denied'});
  assert.equal(f.policy.canRead(f.bot,{kind:'material',id:'mb'}),true);
  await f.policy.authorizeShare(f.human,{operationId:'grant',action:'grant.set',input:{grantId:'g',ownerBotId:'b',recipientBotId:'a',level:'control',scope:{materials:['*'],tasks:['tb']},active:true}});
  assert.throws(()=>f.policy.require(f.bot,'material.archive',{kind:'material',id:'mb'}),{code:'access_denied'});
  f.policy.requireTaskTargetControl(f.bot,'b','tb',f.store.read());assert.throws(()=>f.policy.requireTaskTargetControl(f.bot,'b','ta',f.store.read()),{code:'access_denied'});
});
test('prospective reads never register actors or borrow a sealed own channel',async t=>{
  const f=await policyFixture(t);
  await f.store.transact({operationId:'sealed',action:'seed'},d=>{d.meetings.meet={epoch:1,phase:'independent'};d.sessions.sa.lineage={meetingId:'meet',epoch:1,phase:'independent',sessionId:'sa'};d.memories.sealed={botId:'a',source:{sessionId:'sa',meetingId:'meet',epoch:1,phase:'independent'}};return null;});
  assert.equal(f.policy.canRead(f.bot,{kind:'memory',id:'sealed'}),true);
  const prospect={botId:'a',purpose:'execution',lineage:f.store.read().sessions.sa.lineage};
  assert.equal(f.policy.canProspectiveBotRead(prospect,{kind:'memory',id:'sealed'}),false);
  assert.equal(f.policy.canProspectiveBotReadDerived(prospect,f.store.read().memories.sealed),false);
  assert.throws(()=>f.policy.require(prospect,'task.create',{kind:'task',id:'ta'}),{code:'access_denied'});
  assert.equal(f.policy.canProspectiveBotRead({botId:'missing',purpose:'execution'},{kind:'task',id:'ta'}),false);
});
test('derived source sessions and materials recheck current sharing',async t=>{
  const f=await policyFixture(t);
  await f.store.transact({operationId:'derived',action:'seed'},d=>{d.memories.derived={botId:'a',source:{sessionId:'sb'}};d.memories.material={botId:'a',source:{kind:'material',docId:'mb'}};return null;});
  assert.equal(f.policy.canRead(f.bot,{kind:'memory',id:'derived'}),true);
  await f.policy.authorizeShare(f.human,{operationId:'revoke',action:'share.set',input:{botId:'b',share:{enabled:false,receivers:['*'],scope:{sessions:['*'],materials:['*']}}}});
  assert.equal(f.policy.canRead(f.bot,{kind:'memory',id:'derived'}),false);assert.equal(f.policy.canRead(f.bot,{kind:'memory',id:'material'}),false);
});
test('schedule principal is authentic, recipe limited and revalidated for receipt delivery',async t=>{
  const f=await policyFixture(t),recipe={botId:'a',title:'scheduled',goal:'goal',criteria:['ok'],dependsOn:[],originSessionId:'sa'};
  await f.store.transact({operationId:'schedule-seed',action:'seed'},d=>{d.schedules.sc={scheduleId:'sc',ownerBotId:'a',enabled:true,consentVersion:1,recipe};d.occurrences.oc={occurrenceId:'oc',scheduleId:'sc',consentVersion:1,state:'claimed',createOperationId:'create-oc',startOperationId:'start-oc'};return null;});
  let valid=true;
  f.policy.registerScheduleAuthority((id,state)=>{assert.equal(id,'oc');if(!valid)throw Error('revoked');return Object.freeze({occurrenceId:id,scheduleId:'sc',consentVersion:1,botId:'a',sessionId:'sa',recipe,recipeHash:digest(recipe),origins:[],taskId:state.occurrences.oc.taskId??null,createOperationId:'create-oc',startOperationId:'start-oc'});});
  const actor=f.policy.fromScheduleOccurrence('oc');assert.equal(actor.kind,'schedule');assert.equal(actor.botId,'a');assert.equal(actor.sessionId,'sa');
  assert.throws(()=>f.policy.registerScheduleAuthority(()=>null),{code:'access_denied'});
  assert.throws(()=>f.policy.require({...actor},'session.send',{kind:'session',id:'sa'}),{code:'access_denied'});
  f.policy.requireScheduleAdmission(actor,'task.create',recipe,f.store.read());
  assert.throws(()=>f.policy.requireScheduleAdmission(actor,'task.create',{...recipe,title:'changed'},f.store.read()),{code:'access_denied'});
  assert.throws(()=>f.policy.command(actor,{operationId:'other',action:'task.create',input:recipe}),{code:'access_denied'});
  f.policy.command(actor,{operationId:'create-oc',action:'task.create',input:recipe});
  f.policy.command(actor,{operationId:'create-oc',action:'task.create',input:{occurrenceId:'oc'}});
  assert.throws(()=>f.policy.command(actor,{operationId:'create-oc',action:'task.create',input:{occurrenceId:'wrong'}}),{code:'access_denied'});
  f.policy.require(actor,'session.send',{kind:'session',id:'sa'});
  assert.throws(()=>f.policy.require(actor,'session.send',{kind:'session',id:'sb'}),{code:'access_denied'});
  assert.throws(()=>f.policy.require(actor,'bot.update',{kind:'bot',id:'a'}),{code:'access_denied'});
  assert.equal(f.policy.canRead(actor,{kind:'task',id:'tb'}),false);
  await f.store.transact({operationId:'scheduled-task',action:'seed'},d=>{
    d.tasks.st={taskId:'st',botId:'a',...recipe,createdBy:{kind:'schedule',occurrenceId:'oc',scheduleId:'sc'},source:{kind:'schedule',occurrenceId:'oc',scheduleId:'sc',sessionId:'sa'},originSessionId:'sa',epoch:1};
    d.occurrences.oc.taskId='st';d.occurrences.oc.state='settled';d.attempts.at={taskId:'st',attemptId:'at',epoch:1,resultOutboxId:'result'};return null;
  });
  const row={kind:'result',taskId:'st',attemptId:'at',epoch:1,outboxId:'result',sessionId:'sa',botId:'a',origins:[]};
  f.policy.requireTaskResultDelivery(row);valid=false;assert.throws(()=>f.policy.requireTaskResultDelivery(row));assert.throws(()=>f.policy.actorKey(actor));
});
test('schedule reads include exact prerequisite evidence sources and exclude unrelated resources',async t=>{
  const f=await policyFixture(t),recipe={botId:'a',title:'scheduled',goal:'goal',criteria:[],dependsOn:['tb'],originSessionId:'sa'};
  await f.store.transact({operationId:'dep-schedule',action:'seed'},d=>{
    d.tasks.tb.currentAttemptId='dep-at';d.attempts['dep-at']={taskId:'tb',result:{source:{sessionId:'sb'},origins:[{kind:'material',id:'mb'}]}};
    d.materials.other={docId:'other',botId:'b'};return null;
  });
  f.policy.registerScheduleAuthority(()=>({occurrenceId:'oc',scheduleId:'sc',consentVersion:1,botId:'a',sessionId:'sa',recipe,recipeHash:digest(recipe),origins:[],createOperationId:'c',startOperationId:'s'}));
  const actor=f.policy.fromScheduleOccurrence('oc');f.policy.require(actor,'session.read',{kind:'session',id:'sb'});f.policy.require(actor,'material.read',{kind:'material',id:'mb'});
  assert.equal(f.policy.canRead(actor,{kind:'material',id:'other'}),false);
});
test('sparse legacy bots cannot inherit new material wildcard, and migrated backup is immutable',async t=>{
  const before=oldState();before.bots.a={botId:'a'};const f=await nativeFixture(t,before),store=await PluginStore.open(f.kv);t.after(()=>store.close());
  assert.deepEqual(store.read().bots.a.share.scope.materials,[]);
  await assert.rejects(store.transact({operationId:'backup-tamper',action:'seed'},d=>{d.migrationBackup.payload.revision--;d.migrationBackup.checksum=digest(d.migrationBackup.payload);return null;}),{code:'malformed_state'});
  assert.equal(store.read().revision,9);
});
test('new schema 2 stores keep their original store identity across transactions',async t=>{
  const f=await nativeFixture(t),store=await PluginStore.open(f.kv);t.after(()=>store.close());const before=store.read();
  await assert.rejects(store.transact({operationId:'store-id-tamper',action:'seed'},d=>{d.storeId='replacement-store';return null;}),{code:'malformed_state'});
  assert.equal(store.read().storeId,before.storeId);assert.equal(store.read().revision,before.revision);
});
