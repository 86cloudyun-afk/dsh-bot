import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialFixture,deferred,eventually,textChunks} from './official-fixture.mjs';
import {PluginStore} from '../../src/native/store.mjs';
import {PermissionPolicy} from '../../src/native/policy.mjs';
import {NativeDshAdapter} from '../../src/native/adapter.mjs';
import {BotDirectory} from '../../src/native/bots.mjs';
import {TaskController} from '../../src/native/tasks.mjs';
import {BotService} from '../../src/native/service.mjs';

// The same real controller/runtime composition as taskFixture, with a failing KV unit.
async function fixture(t,{stream}={}) {
  const native=await createOfficialFixture({stream});let failing=false,writes=0;
  const failure=Object.assign(Error('PRIVATE_STORAGE_FAILURE'),{code:'EIO'});
  const kv={async open(descriptor){const unit=await native.ctx.storage.backend.get('json').kv.open(descriptor);return {loadAll:unit.loadAll.bind(unit),close:unit.close.bind(unit),async putRecord(...args){if(failing){writes++;throw failure;}return unit.putRecord(...args);}};}};
  const store=await PluginStore.open(kv),operator={},policy=new PermissionPolicy(store,{agents:native.ctx.agents,operatorPeer:operator}),human=policy.fromPeer(operator),adapter=new NativeDshAdapter(native.ctx,{store,policy});
  const bots=new BotDirectory(store,policy,adapter),tasks=new TaskController({store,policy,adapter}),service=new BotService({store,policy,adapter,tasks});adapter.setService(service);
  t.after(async()=>{await service.close();try{await tasks.close();}finally{await adapter.close();await store.close();await native.close();}});
  const bot=await bots.create(human,{operationId:'bot',action:'bot.create',input:{name:'Worker',role:'Test',cwd:native.dir,contact:{provider:'controlled',model:'model-a'}}});
  return {...native,store,policy,human,adapter,tasks,bot,get writes(){return writes},async fence(){failing=true;await assert.rejects(store.transact({operationId:'failed-write',action:'test.storage'},()=>true),error=>error===failure);}};
}

test('idle actual TaskController closes after a real storage EIO without changing durable evidence',async t=>{
  const f=await fixture(t);await f.fence();const before=f.store.read({diagnostic:true});
  await f.tasks.close();assert.deepEqual(f.store.read({diagnostic:true}),before);assert.throws(()=>f.store.read(),{code:'recovery_required'});assert.equal(f.writes,1);
});

test('fenced TaskController close drains original owned native model while retaining reservation and all original IDs',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());const f=await fixture(t,{stream:async function*(){await gate.promise;yield* textChunks('Original response');}});
  const task=await f.tasks.create(f.human,{operationId:'original-create',action:'task.create',input:{botId:f.bot.botId,title:'Original',goal:'One response',criteria:[]}});
  const attempt=await f.tasks.start(f.human,{operationId:'original-start',action:'task.start',input:{taskId:task.taskId,expectedVersion:task.version}});
  await eventually(()=>f.requests.length===1&&f.adapter.resources(attempt.sessionId).models===1);
  assert.equal(f.store.read().attempts[attempt.attemptId].reservationHeld,true);
  await f.fence();const before=f.store.read({diagnostic:true}),stops=[],stopResources=f.adapter.stopResources.bind(f.adapter);
  f.adapter.stopResources=async id=>{stops.push(id);const stopping=stopResources(id);gate.resolve();return stopping;};
  await f.tasks.close();
  assert.deepEqual(stops,[attempt.sessionId]);await eventually(()=>f.adapter.resources(attempt.sessionId).settled);
  const resources=f.adapter.resources(attempt.sessionId);assert.equal(resources.known,true);assert.equal(resources.models,0);assert.equal(resources.tools,0);assert.deepEqual(resources.resourceFaults,[]);
  assert.deepEqual(f.store.read({diagnostic:true}),before);assert.equal(before.attempts[attempt.attemptId].reservationHeld,true);assert.equal(before.attempts[attempt.attemptId].runtimeId,f.tasks.runtimeId);assert.equal(Object.keys(before.attempts).length,1);assert.equal(f.writes,1);assert.equal(f.requests.length,1);assert.throws(()=>f.store.read(),{code:'recovery_required'});
});
