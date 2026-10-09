import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFixture} from './business-fixture.mjs';
import {deferred} from './official-fixture.mjs';

for (const action of ['archive','restore']) {
  for (const staleRead of [false,true]) {
    test(`v1.1.1 ${action} rejects configuring contact before intent${staleRead ? ' after an earlier native read' : ''}`,async t=>{
      const f=await businessFixture(t),bot=await f.bot(),row=await f.sessions.create(f.human,{operationId:'contact',action:'session.create',input:{botId:bot.botId}});
      const nativeBefore=await f.adapter.readNative(row.sessionId),configureEntered=deferred(),configureRelease=deferred(),readEntered=deferred(),readRelease=deferred();
      const configureNative=f.adapter.configureOwned.bind(f.adapter),readNative=f.adapter.readNative.bind(f.adapter);
      f.adapter.configureOwned=async(...args)=>{configureEntered.resolve();await configureRelease.promise;return configureNative(...args);};
      let interceptRead=staleRead;
      f.adapter.readNative=async(...args)=>{
        const hold=interceptRead;interceptRead=false;
        const native=await readNative(...args);
        if(hold){readEntered.resolve();await readRelease.promise;}
        return native;
      };
      const registry=f.ctx.workspaceRegistry,archiveNative=registry.archiveSession.bind(registry),restoreNative=registry.unarchiveSession.bind(registry);
      let registryCalls=0;
      registry.archiveSession=async(...args)=>{registryCalls++;return archiveNative(...args);};
      registry.unarchiveSession=async(...args)=>{registryCalls++;return restoreNative(...args);};
      const configureCommand={operationId:'configure',action:'session.configure',input:{sessionId:row.sessionId,expectedVersion:1,name:'Original configure title',model:{provider:'controlled',model:'model-b'}}};
      const competingCommand={operationId:action,action:`session.${action}`,input:{sessionId:row.sessionId}};
      let competing;
      if(staleRead){competing=f.sessions[action](f.human,competingCommand);await readEntered.promise;}
      const configuring=f.sessions.configure(f.human,configureCommand).then(value=>({value}),error=>({error}));
      await configureEntered.promise;
      try {
        const pending=f.store.read();assert.equal(pending.sessions[row.sessionId].state,'configuring');
        if(staleRead)readRelease.resolve();else competing=f.sessions[action](f.human,competingCommand);
        await assert.rejects(competing,{code:'operation_pending'});
        assert.deepEqual(f.store.read(),pending,'competing mutation must not write an intent or operation receipt');
        assert.equal(registryCalls,0);
        assert.equal(registry.archivedSessionIds.includes(row.sessionId),false);
        assert.deepEqual(await readNative(row.sessionId),nativeBefore);
        configureRelease.resolve();
        const configured=await configuring;assert.equal(configured.error,undefined);assert.equal(configured.value.state,'ready');assert.equal(configured.value.revision,2);
        assert.equal(configured.value.name,'Original configure title');assert.equal(configured.value.model.model,'model-b');
        const state=f.store.read(),intent=state.operations.configure.result;
        assert.deepEqual(state.operations[intent.statusOperationId].result,configured.value);
        assert.deepEqual(await f.sessions.configure(f.human,configureCommand),configured.value);
        const events=(await readNative(row.sessionId)).events;
        assert.equal(events.filter(event=>event.type==='session/title'&&event.data.title==='Original configure title').length,1);
        assert.equal(events.filter(event=>event.type==='model/selection'&&event.data.model==='model-b').length,1);
        assert.equal(state.sessions[row.sessionId].state,'ready');assert.equal(state.sessions[row.sessionId].archived,false);
      } finally {
        readRelease.resolve();configureRelease.resolve();await configuring;
      }
    });
  }
}

for(const action of ['archive','restore']) {
  test(`v1.1.1 ${action} preserves a concurrent configure UNKNOWN outcome after an earlier native read`,async t=>{
    const f=await businessFixture(t),bot=await f.bot(),row=await f.sessions.create(f.human,{operationId:'contact',action:'session.create',input:{botId:bot.botId}});
    const readEntered=deferred(),readRelease=deferred(),read=f.adapter.readNative.bind(f.adapter),configure=f.adapter.configureOwned.bind(f.adapter);
    let holdRead=true,configureCalls=0;
    f.adapter.readNative=async(...args)=>{
      const hold=holdRead;holdRead=false;const native=await read(...args);
      if(hold){readEntered.resolve();await readRelease.promise;}
      return native;
    };
    f.adapter.configureOwned=async(...args)=>{
      configureCalls++;const evidence=await configure(...args);
      throw Object.assign(Error('Lost configure receipt after native title/model apply'),{code:'fixture_lost_receipt',details:{nativeConfigEvidence:evidence}});
    };
    const registry=f.ctx.workspaceRegistry,nativeMethod=action==='archive'?'archiveSession':'unarchiveSession',native=registry[nativeMethod].bind(registry);
    let registryCalls=0;
    registry[nativeMethod]=async(...args)=>{registryCalls++;return native(...args);};
    const competingCommand={operationId:'competing-archive-operation',action:`session.${action}`,input:{sessionId:row.sessionId}},configureCommand={operationId:'configure',action:'session.configure',input:{sessionId:row.sessionId,expectedVersion:1,name:'Native uncertain title',model:{provider:'controlled',model:'model-c'}}};
    const competing=f.sessions[action](f.human,competingCommand).then(value=>({value}),error=>({error}));
    await readEntered.promise;
    try {
      await assert.rejects(f.sessions.configure(f.human,configureCommand),{code:'fixture_lost_receipt'});
      const before=f.store.read(),unknown=before.sessions[row.sessionId],configureIntent=before.operations.configure.result,nativeBefore=await read(row.sessionId);
      assert.equal(unknown.state,'UNKNOWN');assert.equal(unknown.error,'fixture_lost_receipt');assert.equal(configureCalls,1);
      assert.equal(Object.hasOwn(before.operations,configureIntent.statusOperationId),false);
      assert.equal(unknown.nativeConfigEvidence.name,'Native uncertain title');assert.equal(unknown.nativeConfigEvidence.model.model,'model-c');
      assert.ok(nativeBefore.events.some(event=>event.type==='session/title'&&event.data.title==='Native uncertain title'));
      assert.ok(nativeBefore.events.some(event=>event.type==='model/selection'&&event.data.model==='model-c'));
      readRelease.resolve();const rejected=await competing;
      assert.equal(rejected.error?.code,'recovery_required');
      assert.deepEqual(f.store.read(),before,'an old ready snapshot must not replace the latest UNKNOWN row or record archive IDs');
      assert.equal(Object.hasOwn(f.store.read().operations,competingCommand.operationId),false);
      assert.equal(registryCalls,0);assert.equal(registry.archivedSessionIds.includes(row.sessionId),false);
      assert.deepEqual(await read(row.sessionId),nativeBefore);
      await assert.rejects(f.sessions.configure(f.human,configureCommand),{code:'session_outcome_unknown'});
      assert.equal(configureCalls,1);assert.deepEqual(f.store.read(),before);assert.equal(registryCalls,0);
    }finally {
      readRelease.resolve();await competing;
    }
  });
}

test('v1.1.1 archive rejects a newer active reply before intent after an earlier idle native read',async t=>{
  const {createUserMessage}=await import('@deepseek-ai/dsh-llm');
  const {eventually,textChunks}=await import('./official-fixture.mjs');
  const replyEntered=deferred(),replyRelease=deferred(),readEntered=deferred(),readRelease=deferred();
  const f=await businessFixture(t,{stream:async function*(options){replyEntered.resolve();await replyRelease.promise;options.signal.throwIfAborted();yield* textChunks('Original newer reply');}}),bot=await f.bot(),row=await f.sessions.create(f.human,{operationId:'contact',action:'session.create',input:{botId:bot.botId}});
  const agent=f.ctx.agents.get(row.sessionId),read=f.adapter.readNative.bind(f.adapter);
  let holdRead=true;
  f.adapter.readNative=async(...args)=>{
    const hold=holdRead;holdRead=false;const native=await read(...args);
    if(hold){readEntered.resolve();await readRelease.promise;}
    return native;
  };
  const registry=f.ctx.workspaceRegistry,archive=registry.archiveSession.bind(registry);let registryCalls=0;
  registry.archiveSession=async(...args)=>{registryCalls++;return archive(...args);};
  const command={operationId:'archive-active-after-read',action:'session.archive',input:{sessionId:row.sessionId}};
  const pending=f.sessions.archive(f.human,command).then(value=>({value}),error=>({error}));
  await readEntered.promise;
  try {
    agent.followup(createUserMessage({content:[{type:'text',text:'Original reply started after archive preflight'}],source:{kind:'v111-session-admission'}}));
    await replyEntered.promise;
    const resources=f.adapter.resources(row.sessionId);assert.equal(resources.known,true);assert.equal(resources.settled,false);assert.equal(resources.models,1);
    assert.equal(agent.status,'running');assert.equal(f.requests.length,1);assert.equal(f.requests[0].signal.aborted,false);
    await f.ctx.sessions.flush(agent.session);
    const before=f.store.read(),nativeBefore=await read(row.sessionId);
    readRelease.resolve();const rejected=await pending;
    assert.equal(rejected.error?.code,'session_active');
    assert.deepEqual(f.store.read(),before,'a reply started during preflight must block intent creation and leave revision unchanged');
    assert.equal(Object.hasOwn(f.store.read().operations,command.operationId),false);
    assert.equal(registryCalls,0);assert.equal(registry.archivedSessionIds.includes(row.sessionId),false);
    assert.deepEqual(await read(row.sessionId),nativeBefore);
    assert.equal(agent.status,'running');assert.equal(f.adapter.resources(row.sessionId).models,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].signal.aborted,false);
    replyRelease.resolve();await eventually(()=>agent.status==='idle');
    assert.ok(f.events.get(row.sessionId).some(event=>event.type==='turn/end'));assert.equal(f.requests.length,1);
  }finally {
    readRelease.resolve();replyRelease.resolve();await pending;await eventually(()=>agent.status==='idle');
  }
});
