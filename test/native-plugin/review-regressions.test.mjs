import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PluginStore} from '../../src/native/store.mjs';
import {PermissionPolicy} from '../../src/native/policy.mjs';
import {createOfficialFixture} from './official-fixture.mjs';

async function fixture(t) {
  const f=await createOfficialFixture(),backend=f.ctx.storage.backend.get('json'),store=await PluginStore.open(backend.kv);
  t.after(async()=>{await store.close();await f.close();});
  const operator={},policy=new PermissionPolicy(store,{agents:f.ctx.agents,operatorPeer:operator});
  await store.transact({operationId:'seed',action:'seed',input:{}},draft=>{
    draft.bots.a={botId:'a',revision:1};draft.bots['a:b']={botId:'a:b',revision:1};draft.bots.other={botId:'other',revision:1};
    draft.sessions['b:c']={sessionId:'b:c',botId:'a',purpose:'contact'};draft.sessions.c={sessionId:'c',botId:'a:b',purpose:'contact'};
    draft.memories.secret={memoryId:'secret',botId:'other',text:'shared information'};draft.tasks.task={taskId:'task',botId:'other'};return null;
  });
  const first=await f.ctx.agents.create({sessionId:'b:c'}),second=await f.ctx.agents.create({sessionId:'c'});
  return {...f,backend,store,policy,operator,human:policy.fromPeer(operator),first:policy.fromAgent(first.agent),second:policy.fromAgent(second.agent)};
}
test('review: bot and session components cannot collide in operation caller identity',async t=>{
  const f=await fixture(t);
  assert.notEqual(f.policy.actorKey(f.first),f.policy.actorKey(f.second));
});
test('review: changing a queued grant input cannot change the admitted operation',async t=>{
  const f=await fixture(t),command={operationId:'grant',action:'grant.set',input:{grantId:'g',ownerBotId:'other',recipientBotId:'a',level:'read',scope:{tasks:['task']},active:true}};
  const pending=f.policy.authorizeShare(f.human,command);command.input.level='control';
  assert.equal((await pending).level,'read');assert.equal(f.store.read().grants.g.level,'read');
});
test('review: empty lineage cannot mask a sealed source and cancellation does not publish it',async t=>{
  const f=await fixture(t);
  await f.store.transact({operationId:'seal',action:'seed',input:{}},draft=>{
    draft.meetings.m={meetingId:'m',epoch:1,phase:'independent'};
    draft.memories.secret.lineage={};draft.memories.secret.source={sessionId:'other-independent',meetingId:'m',epoch:1,phase:'independent'};return null;
  });
  assert.equal(f.policy.canRead(f.first,{kind:'memory',id:'secret'}),false);
  await f.store.transact({operationId:'cancel',action:'seed',input:{}},draft=>{draft.meetings.m.phase='cancelled';return null;});
  assert.equal(f.policy.canRead(f.first,{kind:'memory',id:'secret'}),false);
});
test('review: a committed revocation with a lost write acknowledgement fences stale reads',async t=>{
  const f=await fixture(t);await f.store.close();let dropAck=false;
  const facet={async open(descriptor){const unit=await f.backend.kv.open(descriptor);return {loadAll:unit.loadAll.bind(unit),close:unit.close.bind(unit),async putRecord(...args){await unit.putRecord(...args);if(dropAck)throw Error('ack lost');}};}};
  const broken=await PluginStore.open(facet),policy=new PermissionPolicy(broken,{agents:f.ctx.agents,operatorPeer:f.operator}),actor=policy.fromAgent(f.ctx.agents.get('b:c'));
  t.after(()=>broken.close());dropAck=true;
  await assert.rejects(broken.transact({operationId:'revoke',action:'seed',input:{}},draft=>{draft.bots.other.share={enabled:false,receivers:['*'],scope:{memories:['*']}};return null;}),/ack lost/);
  assert.throws(()=>policy.canRead(actor,{kind:'memory',id:'secret'}),{code:'recovery_required'});
});
test('review: malformed stored grant cannot turn an inactive control grant active',async t=>{
  const f=await fixture(t);
  await f.policy.authorizeShare(f.human,{operationId:'grant',action:'grant.set',input:{grantId:'g',ownerBotId:'other',recipientBotId:'a',level:'control',scope:{tasks:['task']},active:false}});
  const draft=f.store.read();await f.store.close();draft.grants.g.active='false';
  const unit=await f.backend.kv.open({name:'dsh_bot_v1',version:1,tables:['state'],hasGlobal:false});await unit.putRecord('state','current',draft);await unit.close();
  const path=join(f.dir,'storage','dsh_bot_v1.json'),before=await readFile(path);
  await assert.rejects(PluginStore.open(f.backend.kv),{code:'malformed_state'});assert.deepEqual(await readFile(path),before);
});

test('review: derived memories retain the current phase barrier of every origin',async t=>{
  const f=await fixture(t);
  await f.store.transact({operationId:'derived',action:'seed',input:{}},draft=>{
    draft.meetings.m={meetingId:'m',epoch:1,phase:'discussion'};
    draft.memories.secret.source={sessionId:'other-independent',meetingId:'m',epoch:1,phase:'independent'};
    draft.memories.derived={memoryId:'derived',botId:'a',text:'copied opinion',origins:[{kind:'memory',id:'secret'}]};return null;
  });
  assert.equal(f.policy.canRead(f.first,{kind:'memory',id:'derived'}),true);
  await f.store.transact({operationId:'reseal',action:'seed',input:{}},draft=>{draft.meetings.m.epoch=2;draft.meetings.m.phase='independent';return null;});
  assert.equal(f.policy.canRead(f.first,{kind:'memory',id:'derived'}),false);
});
