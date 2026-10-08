import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PluginStore} from '../../src/native/store.mjs';
import {createOfficialFixture} from './official-fixture.mjs';

async function fixture(t) {
  const native = await createOfficialFixture();
  const store = await PluginStore.open(native.ctx.storage.backend.get('json').kv);
  t.after(async()=>{await store.close();await native.close();});
  const sid = randomUUID(), other = randomUUID();
  await store.transact({operationId:'seed',action:'seed',input:{}}, draft => {
    draft.bots.a={botId:'a',revision:1};draft.bots.b={botId:'b',revision:1};
    draft.sessions[sid]={sessionId:sid,botId:'a',purpose:'contact'};
    draft.sessions[other]={sessionId:other,botId:'b',purpose:'contact'};
    draft.memories.mb={memoryId:'mb',botId:'b',text:'shared fact'};
    draft.tasks.tb={taskId:'tb',botId:'b'};return null;
  });
  const module = await import('../../src/native/policy.mjs').catch(e => {if(e.code==='ERR_MODULE_NOT_FOUND')assert.fail('PermissionPolicy feature is missing');throw e;});
  const operator = {}, policy = new module.PermissionPolicy(store,{agents:native.ctx.agents,operatorPeer:operator});
  const handle=await native.ctx.agents.create({sessionId:sid,agentOptions:{provider:'controlled',model:'model-a'}});
  const human=policy.fromPeer(operator), bot=policy.fromAgent(handle.agent);
  return {...native,store,policy,handle,human,bot,sid,other};
}
test('forged human and bot labels confer no authority',async t=>{
  const f=await fixture(t);
  assert.throws(()=>f.policy.fromPeer({}),{code:'access_denied'});
  assert.throws(()=>f.policy.fromAgent({id:f.sid}),{code:'access_denied'});
  assert.throws(()=>f.policy.require({kind:'human'},'bot.update',{kind:'bot',id:'b'}),{code:'access_denied'});
});
test('default sharing permits reads but no foreign control or memory write',async t=>{
  const f=await fixture(t);
  assert.equal(f.policy.canRead(f.bot,{kind:'session',id:f.other}),true);
  assert.equal(f.policy.canRead(f.bot,{kind:'memory',id:'mb'}),true);
  for(const [action,kind,id] of [['session.send','session',f.other],['task.stop','task','tb'],['memory.write','memory','mb'],['share.update','bot','b']])
    assert.throws(()=>f.policy.require(f.bot,action,{kind,id}),{code:'access_denied'});
  assert.equal(f.policy.canRead(f.bot,{kind:'session',id:'ordinary'}),false);
});
test('control cannot exceed the sharing ceiling and revocation affects held callers',async t=>{
  const f=await fixture(t);
  await f.policy.authorizeShare(f.human,{operationId:'grant',action:'grant.set',input:{grantId:'g',ownerBotId:'b',recipientBotId:'a',level:'control',scope:{tasks:['tb']},active:true}});
  f.policy.require(f.bot,'task.stop',{kind:'task',id:'tb'});
  assert.throws(()=>f.policy.require(f.bot,'session.send',{kind:'session',id:f.other}),{code:'access_denied'});
  await f.policy.authorizeShare(f.human,{operationId:'close',action:'share.set',input:{botId:'b',share:{enabled:false,receivers:['a'],scope:{tasks:['tb']}}}});
  assert.equal(f.policy.canRead(f.bot,{kind:'task',id:'tb'}),false);
  assert.throws(()=>f.policy.require(f.bot,'task.stop',{kind:'task',id:'tb'}),{code:'access_denied'});
  await f.policy.authorizeShare(f.human,{operationId:'reopen',action:'share.set',input:{botId:'b',share:{enabled:true,receivers:['a'],scope:{tasks:['tb']}}}});
  f.policy.require(f.bot,'task.stop',{kind:'task',id:'tb'});
  await f.policy.authorizeShare(f.human,{operationId:'revoke',action:'grant.set',input:{grantId:'g',ownerBotId:'b',recipientBotId:'a',level:'read',scope:{tasks:['tb']},active:false}});
  assert.throws(()=>f.policy.require(f.bot,'task.stop',{kind:'task',id:'tb'}),{code:'access_denied'});
});
test('sealed opinions are readable only by their own independent channel',async t=>{
  const f=await fixture(t);
  await f.store.transact({operationId:'seal',action:'seed',input:{}},draft=>{
    draft.meetings.m={meetingId:'m',epoch:1,phase:'independent'};
    draft.sessions[f.other].lineage={meetingId:'m',epoch:1,phase:'independent'};
    draft.memories.ma={memoryId:'ma',botId:'a',text:'sealed',source:{sessionId:'a-independent',meetingId:'m',epoch:1,phase:'independent'}};
    return null;
  });
  assert.equal(f.policy.canRead(f.bot,{kind:'session',id:f.other}),false);
  assert.equal(f.policy.canRead(f.bot,{kind:'memory',id:'ma'}),false);
  await f.store.transact({operationId:'reveal',action:'seed',input:{}},draft=>{draft.meetings.m.phase='discussion';return null;});
  assert.equal(f.policy.canRead(f.bot,{kind:'memory',id:'ma'}),true);
});
