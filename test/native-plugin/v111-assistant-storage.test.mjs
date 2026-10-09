import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {businessFixture} from './business-fixture.mjs';
import {PluginStore} from '../../src/native/store.mjs';
import {PermissionPolicy} from '../../src/native/policy.mjs';
import {AssistantController} from '../../src/native/assistant.mjs';
import {BotService} from '../../src/native/service.mjs';
import {TaskController} from '../../src/native/tasks.mjs';

async function storageFixture(t,{autonomous=false,kind='reminder',failOnWrite=1}={}) {
  const f=await businessFixture(t),bot=await f.bot(),session=await f.sessions.create(f.human,{operationId:'contact',action:'session.create',input:{botId:bot.botId}});await f.store.close();
  let failWrites=false,writeAttempts=0,timers=0,active=new Set();
  const failure=Object.assign(Error('PRIVATE_DISK_PATH_AND_SECRET'),{code:'EIO'});
  const wrappedKv={async open(descriptor){const unit=await f.ctx.storage.backend.get('json').kv.open(descriptor);return {loadAll:unit.loadAll.bind(unit),close:unit.close.bind(unit),putRecord:async(...args)=>{if(failWrites&&++writeAttempts>=failOnWrite)throw failure;return unit.putRecord(...args);}};}};
  const store=await PluginStore.open(wrappedKv),operator={},policy=new PermissionPolicy(store,{agents:f.ctx.agents,operatorPeer:operator}),human=policy.fromPeer(operator);
  let now=Date.parse('2026-10-09T00:00:00Z');
  const tasks=new TaskController({...f,store,policy}),assistant=new AssistantController({store,policy,adapter:f.adapter,tasks,clock:{now:()=>now,setTimeout(fn){timers++;if(!autonomous)return 1;let id;id=setTimeout(()=>{active.delete(id);return fn();},5);active.add(id);return id;},clearTimeout(id){active.delete(id);clearTimeout(id);}}});
  t.after(async()=>{await assistant.close();await tasks.close();await store.close();});
  await store.transact({operationId:'original-evidence',action:'test.evidence'},draft=>{
    draft.tasks['retained-task']={taskId:'retained-task',state:'running'};
    draft.attempts['retained-attempt']={attemptId:'retained-attempt',taskId:'retained-task',state:'UNKNOWN',reservationHeld:true};
    draft.outbox['retained-result']={outboxId:'retained-result',taskId:'retained-task',attemptId:'retained-attempt',state:'UNKNOWN',operationId:'retained-delivery',message:{id:'retained-message'}};
    return true;
  });
  await assistant.createSchedule(human,{operationId:'schedule',action:'schedule.create',input:{ownerBotId:bot.botId,kind,...(kind==='task'?{recipe:{botId:bot.botId,title:'Work',goal:'One response',criteria:[],originSessionId:session.sessionId}}:{message:'Reminder'}),rule:{kind:'once',timezone:'UTC',date:'2026-10-09',time:'00:01'}}});
  await assistant.start();const before=store.read();
  const service=new BotService({store,policy,adapter:f.adapter,tasks:{},broker:{},assistant});t.after(()=>service.close());
  return {store,assistant,service,human,before,failure,armedTimers:timers,get writeAttempts(){return writeAttempts},get timers(){return timers},active,fail(){failWrites=true;now=Date.parse('2026-10-09T00:01:00Z')}};
}

if(!process.env.DSH_ASSISTANT_STORAGE_CHILD) {
test('explicit runDue preserves the actual EIO while fencing storage and cancelling the lifecycle timer',async t=>{
  const f=await storageFixture(t);f.fail();
  await assert.rejects(f.assistant.runDue(),error=>error===f.failure);
  assert.throws(()=>f.store.read(),{code:'recovery_required'});assert.deepEqual(f.store.read({diagnostic:true}),f.before);assert.equal(f.writeAttempts,1);assert.equal(f.timers,f.armedTimers);
  const diagnostic=f.assistant.diagnostics(f.human);assert.deepEqual(diagnostic.backgroundFailure,{errorCode:'recovery_required',phase:'storage'});assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_DISK|EIO/);
  const rpc=await f.service.dispatch(f.human,{action:'diagnostics.read',input:{}});assert.deepEqual(rpc,diagnostic);
  await assert.rejects(f.service.dispatch(f.human,{operationId:'fenced-write',action:'schedule.update',input:{scheduleId:Object.keys(f.before.schedules)[0],expectedVersion:1,message:'Changed'}}),{code:'recovery_required'});
  assert.throws(()=>f.assistant.diagnostics({kind:'human'}),{code:'access_denied'});
  await assert.rejects(f.assistant.runDue(),{code:'recovery_required'});assert.equal(f.writeAttempts,1);await f.assistant.close();
});

test('actual scheduled task creation EIO retains the first error and the durable claim without synthesizing an outcome',async t=>{
  const f=await storageFixture(t,{kind:'task',failOnWrite:3});f.fail();
  await assert.rejects(f.assistant.runDue(),error=>error===f.failure);
  const state=f.store.read({diagnostic:true}),old=Object.values(state.occurrences)[0];assert.equal(old.state,'claimed');assert.equal(old.taskId,undefined);assert.equal(state.operations[old.createOperationId],undefined);assert.equal(state.operations[old.startOperationId],undefined);assert.equal(f.writeAttempts,3);assert.equal(f.timers,f.armedTimers);
  assert.deepEqual(state.attempts,f.before.attempts);assert.deepEqual(state.outbox,f.before.outbox);assert.deepEqual(state.tasks,f.before.tasks);assert.throws(()=>f.store.read(),{code:'recovery_required'});
  await assert.rejects(f.assistant.runDue(),{code:'recovery_required'});assert.deepEqual(f.store.read({diagnostic:true}),state);assert.equal(f.writeAttempts,3);
});

test('real autonomous PluginStore EIO is contained in a surviving subprocess without retry or evidence loss',async()=>{
  const script=`
    import assert from 'node:assert/strict';
    import {storageFixtureForSubprocess} from ${JSON.stringify(import.meta.url)};
    const cleanup=[],unhandled=[];process.on('unhandledRejection',error=>unhandled.push(error));
    const f=await storageFixtureForSubprocess({after(fn){cleanup.unshift(fn)}});
    try {
      f.fail();await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(unhandled.length,0,'autonomous storage rejection escaped to the host');
      assert.equal(f.writeAttempts,1);assert.equal(f.timers,f.armedTimers);assert.equal(f.active.size,0);
      assert.throws(()=>f.store.read(),{code:'recovery_required'});assert.deepEqual(f.store.read({diagnostic:true}),f.before);
      assert.deepEqual(f.assistant.diagnostics(f.human).backgroundFailure,{errorCode:'recovery_required',phase:'storage'});
      assert.deepEqual(await f.service.dispatch(f.human,{action:'diagnostics.read',input:{}}),f.assistant.diagnostics(f.human));
      assert.doesNotMatch(JSON.stringify(f.assistant.diagnostics(f.human)),/PRIVATE_DISK|EIO/);
      await f.assistant.close();console.log('SURVIVED_CLOSED_WITH_ORIGINAL_EVIDENCE');
    } finally {for(const close of cleanup)await close();}
  `;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,DSH_ASSISTANT_STORAGE_CHILD:'1'},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);
    const timeout=setTimeout(()=>{child.kill();reject(Error('storage child failed to close'));},10000);
    child.on('close',code=>{clearTimeout(timeout);resolve({code,stdout,stderr});});
  });
  assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/SURVIVED_CLOSED_WITH_ORIGINAL_EVIDENCE/);assert.equal(result.stderr,'');
});
}

export const storageFixtureForSubprocess=t=>storageFixture(t,{autonomous:true});
