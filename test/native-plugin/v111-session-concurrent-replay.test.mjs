import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFixture} from './business-fixture.mjs';
import {deferred} from './official-fixture.mjs';

for(const action of ['archive','restore']) {
  for(const outcome of ['lost','pending','settled']) {
    test(`v1.1.1 concurrent ${action} duplicate cannot repeat a ${outcome} original intent after its earlier native read`,async t=>{
      const f=await businessFixture(t),bot=await f.bot(),row=await f.sessions.create(f.human,{operationId:'contact',action:'session.create',input:{botId:bot.botId}});
      if(action==='restore')await f.sessions.archive(f.human,{operationId:'initial-archive',action:'session.archive',input:{sessionId:row.sessionId}});
      const readEntered=deferred(),readRelease=deferred(),nativeEntered=deferred(),nativeRelease=deferred(),read=f.adapter.readNative.bind(f.adapter);
      let holdRead=true;
      f.adapter.readNative=async(...args)=>{
        const hold=holdRead;holdRead=false;const saved=await read(...args);
        if(hold){readEntered.resolve();await readRelease.promise;}
        return saved;
      };
      const registry=f.ctx.workspaceRegistry,nativeMethod=action==='archive'?'archiveSession':'unarchiveSession',native=registry[nativeMethod].bind(registry);
      let registryCalls=0;
      registry[nativeMethod]=async(...args)=>{
        registryCalls++;
        if(outcome==='pending'&&registryCalls===1){nativeEntered.resolve();await nativeRelease.promise;}
        await native(...args);
        if(outcome==='lost')throw Object.assign(Error('Lost original native receipt'),{code:'fixture_lost_receipt'});
      };
      const command={operationId:'same-operation',action:`session.${action}`,input:{sessionId:row.sessionId}};
      const delayed=f.sessions[action](f.human,command).then(value=>({value}),error=>({error}));
      await readEntered.promise;
      const owner=f.sessions[action](f.human,command).then(value=>({value}),error=>({error}));
      try {
        let original;
        if(outcome==='pending')await nativeEntered.promise;
        else {
          original=await owner;
          if(outcome==='lost')assert.equal(original.error?.code,'fixture_lost_receipt');
          else assert.equal(original.error,undefined);
        }
        const before=f.store.read(),intent=before.operations[command.operationId].result;
        assert.equal(before.sessions[row.sessionId].state,outcome==='lost'?'UNKNOWN':outcome==='pending'?(action==='archive'?'archiving':'restoring'):'ready');
        assert.equal(registryCalls,1);
        const nativeBefore=[...registry.archivedSessionIds];
        readRelease.resolve();const duplicate=await delayed;
        if(outcome==='settled'){
          assert.equal(duplicate.error,undefined);assert.deepEqual(duplicate.value,original.value);
        }else assert.equal(duplicate.error?.code,'session_outcome_unknown');
        assert.equal(registryCalls,1,'the duplicate must never invoke the real native registry');
        assert.deepEqual(f.store.read(),before,'duplicate replay must not add a new UNKNOWN write or mutate the original IDs');
        assert.deepEqual(registry.archivedSessionIds,nativeBefore);
        assert.equal(f.store.read().sessions[row.sessionId].archiveOperationId,command.operationId);
        assert.equal(f.store.read().sessions[row.sessionId].archiveStatusId,intent.statusOperationId);
        if(outcome==='pending'){
          nativeRelease.resolve();const settled=await owner;assert.equal(settled.error,undefined);
          const state=f.store.read();assert.deepEqual(state.operations[intent.statusOperationId].result,settled.value);
          assert.equal(state.sessions[row.sessionId].state,'ready');assert.equal(state.sessions[row.sessionId].archived,action==='archive');
        }
      }finally {
        readRelease.resolve();nativeRelease.resolve();await Promise.all([owner,delayed]);
      }
    });
  }
}
