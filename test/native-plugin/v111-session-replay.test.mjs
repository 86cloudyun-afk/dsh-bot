import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {businessFixture} from './business-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

const command=(action,sessionId,operationId=action)=>({operationId,action:`session.${action}`,input:{sessionId}});

// Wrap real native work to observe effects without substituting registry or storage behavior.
function observeNative(f) {
  const read=f.adapter.readNative.bind(f.adapter),registry=f.ctx.workspaceRegistry,
    archive=registry.archiveSession.bind(registry),restore=registry.unarchiveSession.bind(registry);
  const calls={reads:0,archives:0,restores:0};
  f.adapter.readNative=async(...args)=>{calls.reads++;return read(...args);};
  registry.archiveSession=async(...args)=>{calls.archives++;return archive(...args);};
  registry.unarchiveSession=async(...args)=>{calls.restores++;return restore(...args);};
  return {calls,read};
}

async function contact(f,bot,operationId='contact') {
  return f.sessions.create(f.human,{operationId,action:'session.create',input:{botId:bot.botId}});
}

async function loseConfigureReceipt(f,row) {
  const configure=f.adapter.configureOwned.bind(f.adapter),op={operationId:'later-configure',action:'session.configure',input:{sessionId:row.sessionId,expectedVersion:1,name:'Applied after original receipt'}};
  f.adapter.configureOwned=async(...args)=>{
    const evidence=await configure(...args);
    throw Object.assign(Error('Lost later configure receipt'),{code:'fixture_lost_receipt',details:{nativeConfigEvidence:evidence}});
  };
  await assert.rejects(f.sessions.configure(f.human,op),{code:'fixture_lost_receipt'});
  assert.equal(f.store.read().sessions[row.sessionId].state,'UNKNOWN');
  return op;
}

test('v1.1.1 settled archive replay returns its original receipt during a later restored native reply',async t=>{
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const f=await businessFixture(t,{stream:async function*(options){entered.resolve();await release.promise;options.signal.throwIfAborted();yield* textChunks('Later restored reply');}}),bot=await f.bot(),row=await contact(f,bot),observed=observeNative(f);
  const originalCommand=command('archive',row.sessionId),original=await f.sessions.archive(f.human,originalCommand);
  await f.sessions.restore(f.human,command('restore',row.sessionId));
  const agent=f.ctx.agents.get(row.sessionId);agent.followup(createUserMessage({content:[{type:'text',text:'A newer restored reply'}],source:{kind:'v111-session-test'}}));
  await entered.promise;assert.equal(agent.status,'running');assert.equal(f.requests.length,1);
  const before=f.store.read(),calls={...observed.calls},nativeArchive=[...f.ctx.workspaceRegistry.archivedSessionIds];
  assert.deepEqual(await f.sessions.archive(f.human,originalCommand),original);
  assert.deepEqual(f.store.read(),before);assert.deepEqual(observed.calls,calls);
  assert.deepEqual(f.ctx.workspaceRegistry.archivedSessionIds,nativeArchive);assert.equal(nativeArchive.includes(row.sessionId),false);
  assert.equal(agent.status,'running');assert.equal(f.requests[0].signal.aborted,false);
  release.resolve();await eventually(()=>agent.status==='idle');
  assert.ok(f.events.get(row.sessionId).some(event=>event.type==='turn/end'));
});

for(const action of ['archive','restore']) {
  test(`v1.1.1 settled ${action} replay survives an unrelated later UNKNOWN configure`,async t=>{
    const f=await businessFixture(t),bot=await f.bot(),row=await contact(f,bot),observed=observeNative(f),archiveCommand=command('archive',row.sessionId),restoreCommand=command('restore',row.sessionId);
    const archived=await f.sessions.archive(f.human,archiveCommand),restored=await f.sessions.restore(f.human,restoreCommand),original=action==='archive'?archived:restored,originalCommand=action==='archive'?archiveCommand:restoreCommand;
    const later=await loseConfigureReceipt(f,row),before=f.store.read(),calls={...observed.calls},native=await observed.read(row.sessionId);
    assert.deepEqual(await f.sessions[action](f.human,originalCommand),original);
    assert.deepEqual(f.store.read(),before);assert.deepEqual(observed.calls,calls);
    assert.equal(f.ctx.workspaceRegistry.archivedSessionIds.includes(row.sessionId),false);
    assert.deepEqual(await observed.read(row.sessionId),native);
    assert.ok(native.events.some(event=>event.type==='session/title'&&event.data.title==='Applied after original receipt'));
    await assert.rejects(f.sessions.configure(f.human,later),{code:'session_outcome_unknown'});
    assert.deepEqual(f.store.read(),before);assert.deepEqual(observed.calls,calls);
  });

  test(`v1.1.1 settled ${action} replay checks the exact actor and command before later UNKNOWN state`,async t=>{
    const f=await businessFixture(t),bot=await f.bot(),row=await contact(f,bot),other=await contact(f,bot,'other-contact'),observed=observeNative(f),archiveCommand=command('archive',row.sessionId),restoreCommand=command('restore',row.sessionId);
    await f.sessions.archive(f.human,archiveCommand);await f.sessions.restore(f.human,restoreCommand);
    const originalCommand=action==='archive'?archiveCommand:restoreCommand,actor=f.policy.fromAgent(f.ctx.agents.get(other.sessionId));
    await loseConfigureReceipt(f,row);const before=f.store.read(),calls={...observed.calls};
    for(const altered of [
      {...originalCommand,action:`session.${action==='archive'?'restore':'archive'}`},
      {...originalCommand,input:{sessionId:other.sessionId}},
      {...originalCommand,expectedRevision:before.revision},
    ])await assert.rejects(f.sessions[action](f.human,altered),{code:'operation_conflict'});
    await assert.rejects(f.sessions[action](actor,originalCommand),{code:'operation_conflict'});
    assert.deepEqual(f.store.read(),before);assert.deepEqual(observed.calls,calls);
  });

  test(`v1.1.1 settled ${action} replay requires a current cross-Bot control grant`,async t=>{
    const f=await businessFixture(t),owner=await f.bot('Owner'),recipient=await f.bot('Recipient'),row=await contact(f,owner),channel=await contact(f,recipient,'recipient-contact'),actor=f.policy.fromAgent(f.ctx.agents.get(channel.sessionId));
    const grant={grantId:'cross-control',ownerBotId:owner.botId,recipientBotId:recipient.botId,scope:{sessions:[row.sessionId]},level:'control',active:true};
    await f.policy.authorizeShare(f.human,{operationId:'grant',action:'grant.set',input:grant});
    const archiveCommand=command('archive',row.sessionId),restoreCommand=command('restore',row.sessionId),archived=await f.sessions.archive(actor,archiveCommand),restored=await f.sessions.restore(actor,restoreCommand),original=action==='archive'?archived:restored,originalCommand=action==='archive'?archiveCommand:restoreCommand;
    await loseConfigureReceipt(f,row);const observed=observeNative(f),authorized=f.store.read();
    await assert.rejects(f.sessions[action]({...actor},originalCommand),{code:'access_denied'});
    assert.deepEqual(await f.sessions[action](actor,originalCommand),original);assert.deepEqual(f.store.read(),authorized);
    await f.policy.authorizeShare(f.human,{operationId:'revoke',action:'grant.set',input:{...grant,active:false}});
    const revoked=f.store.read();
    await assert.rejects(f.sessions[action](actor,originalCommand),{code:'access_denied'});
    await assert.rejects(f.sessions[action]({...actor},originalCommand),{code:'access_denied'});
    assert.deepEqual(f.store.read(),revoked);assert.deepEqual(observed.calls,{reads:0,archives:0,restores:0});
    assert.equal(f.ctx.workspaceRegistry.archivedSessionIds.includes(row.sessionId),false);
  });

  test(`v1.1.1 unresolved ${action} intent never repeats its original native effect`,async t=>{
    const f=await businessFixture(t),bot=await f.bot(),row=await contact(f,bot);
    if(action==='restore')await f.sessions.archive(f.human,command('archive',row.sessionId,'initial-archive'));
    const registry=f.ctx.workspaceRegistry,nativeMethod=action==='archive'?'archiveSession':'unarchiveSession',native=registry[nativeMethod].bind(registry);let calls=0;
    registry[nativeMethod]=async(...args)=>{calls++;await native(...args);throw Object.assign(Error('Lost original registry receipt'),{code:'fixture_lost_receipt'});};
    const originalCommand=command(action,row.sessionId);
    await assert.rejects(f.sessions[action](f.human,originalCommand),{code:'fixture_lost_receipt'});
    const before=f.store.read(),intent=before.operations[originalCommand.operationId].result;
    assert.equal(before.sessions[row.sessionId].state,'UNKNOWN');assert.equal(Object.hasOwn(before.operations,intent.statusOperationId),false);
    await assert.rejects(f.sessions[action](f.human,originalCommand));
    assert.equal(calls,1);assert.deepEqual(f.store.read(),before);
    assert.equal(registry.archivedSessionIds.includes(row.sessionId),action==='archive');
  });
}
