import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFixture} from './business-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';

test('the running service exposes the exact package release and client protocol',async t=>{
  const f=await businessFixture(t), service=new BotService(f);
  const manifest=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../package.json',import.meta.url),'utf8'));
  const snapshot=service.snapshot(f.human);
  assert.equal(snapshot.pluginVersion,manifest.version);
  assert.equal(snapshot.clientProtocol,2);
});

test('operator receipt lookup is read-only and verifies the exact retained request',async t=>{
  const f=await businessFixture(t), service=new BotService(f);
  const request={operationId:'first-bot',action:'bot.create',input:{name:'Original',contact:{provider:'controlled',model:'model-a'}}};
  const bot=await service.dispatch(f.human,request), before=f.store.read();
  assert.deepEqual(await service.dispatch(f.human,{action:'operation.lookup',input:{operationId:request.operationId,request}}),{state:'committed',action:request.action,result:bot});
  assert.deepEqual(f.store.read(),before);
  assert.equal(f.requests.length,0);
  await assert.rejects(service.dispatch(f.human,{action:'operation.lookup',input:{operationId:request.operationId,request:{...request,input:{...request.input,name:'Changed'}}}}),{code:'operation_conflict'});
});

test('absent operation receipt remains unrecorded and triggers no side effects',async t=>{
  const f=await businessFixture(t), service=new BotService(f), before=f.store.read();
  assert.deepEqual(await service.dispatch(f.human,{action:'operation.lookup',input:{operationId:'missing'}}),{state:'unrecorded'});
  assert.deepEqual(f.store.read(),before);
  assert.equal(f.requests.length,0);
});

test('Bot callers cannot read operator operation receipts',async t=>{
  const f=await businessFixture(t), service=new BotService(f), bot=await f.bot();
  const binding=await f.sessions.create(f.human,{operationId:'contact',action:'session.create',input:{botId:bot.botId}});
  const actor=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId));
  await assert.rejects(service.dispatch(actor,{action:'operation.lookup',input:{operationId:'create-A'}}),{code:'human_required'});
});
