import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createOfficialFixture,deferred} from './official-fixture.mjs';
import * as Plugin from '../../src/native/plugin.mjs';

async function mounted(t) {
  const f=await createOfficialFixture(),operator={};let plugin;
  f.ctx.provide('profileContext',{name:'v11-lifecycle',dir:f.dir});f.ctx.provide('webServer',{});
  f.ctx.provide('connection',{operator,fetch:{register(){return()=>{};}}});
  t.after(async()=>{await plugin?.dispose();await f.close();});
  const boot=async()=>{plugin=f.ctx.plugin(Plugin);await plugin.await();return f.ctx.get('dshBot');};
  const service=await boot(),human=service.policy.fromPeer(operator);
  const bot=await service.dispatch(human,{action:'bot.create',operationId:randomUUID(),input:{name:'生命周期 Bot',cwd:f.dir,contact:{provider:'controlled',model:'model-a'}}});
  const session=await service.dispatch(human,{action:'session.create',operationId:randomUUID(),input:{botId:bot.botId}});
  return {...f,service,human,session,boot,async dispose(){const old=plugin;plugin=null;await old.dispose();}};
}
test('scoped actual plugin injects the native projection required for session configuration',async t=>{
  const f=await mounted(t),saved=await f.service.dispatch(f.human,{action:'session.configure',operationId:randomUUID(),input:{sessionId:f.session.sessionId,expectedVersion:1,name:'原生已改名'}});
  assert.equal(saved.state,'ready');assert.equal(saved.name,'原生已改名');assert.equal(saved.revision,2);
  assert.equal((await f.service.adapter.readNative(saved.sessionId)).events.findLast(row=>row.type==='session/title').data.title,'原生已改名');
  assert.equal(f.requests.length,0);
});
test('plugin shutdown drains an accepted native configuration before closing store and preserves final receipt on reopen',async t=>{
  const f=await mounted(t),nativeDone=deferred(),release=deferred(),configure=f.service.adapter.configureOwned.bind(f.service.adapter);
  t.after(()=>release.resolve());
  f.service.adapter.configureOwned=async(...args)=>{const saved=await configure(...args);nativeDone.resolve();await release.promise;return saved;};
  const operationId=randomUUID(),pending=f.service.dispatch(f.human,{action:'session.configure',operationId,input:{sessionId:f.session.sessionId,expectedVersion:1,name:'关闭前完成的配置'}}).then(value=>({value}),error=>({error}));
  await nativeDone.promise;
  let closed=false;const closing=f.dispose().then(()=>{closed=true;});
  await new Promise(resolve=>setTimeout(resolve,25));
  const closedEarly=closed;release.resolve();const result=await pending;await closing;
  assert.equal(closedEarly,false,'closing the store must wait for accepted configuration receipt');assert.equal(result.error,undefined);
  const next=await f.boot(),state=next.store.read(),row=state.sessions[f.session.sessionId];
  assert.equal(row.state,'ready');assert.equal(row.name,'关闭前完成的配置');assert.equal(row.revision,2);
  const original=state.operations[operationId].result;assert.equal(state.operations[original.statusOperationId].result.name,row.name);
  assert.equal(f.requests.length,0);
});
