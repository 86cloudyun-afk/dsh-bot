import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Jobs from '@deepseek-ai/dsh-jobs-local';
import {createOfficialFixture,deferred,eventually,textChunks} from './official-fixture.mjs';
import {PluginStore} from '../../src/native/store.mjs';
import {openProfileScope} from '../../src/native/profile.mjs';
import * as Plugin from '../../src/native/plugin.mjs';

async function heldPlugin(t) {
  const releaseModels=deferred(),releaseJob=deferred(),streams=[],unhandled=[];
  const onUnhandled=error=>unhandled.push(error);process.on('unhandledRejection',onUnhandled);
  const f=await createOfficialFixture({stream:async function*(options){
    const row={sessionId:options.sessionId,signal:options.signal,finished:false};streams.push(row);
    try {await releaseModels.promise;yield* textChunks('Late original response');} finally {row.finished=true;}
  }}),operator={},profile={name:'v111-storage-shutdown',dir:f.dir};
  f.ctx.provide('profileContext',profile);f.ctx.provide('webServer',{});
  f.ctx.provide('connection',{operator,fetch:{register(){return()=>{};}}});
  const jobsPlugin=f.ctx.plugin(Jobs);await jobsPlugin.await();const detach=f.ctx.jobs.attachController('fenced-shutdown-test');
  const kv=f.ctx.storage.backend.get('json').kv,open=kv.open.bind(kv);
  let failWrites=false,writeAttempts=0,unitClosed=false,plugin,cancelledJobs=0;
  const failure=Object.assign(Error('original storage EIO'),{code:'EIO'});
  kv.open=async descriptor=>{
    const unit=await open(descriptor);
    if(!descriptor.name.startsWith('dsh_bot_v1_'))return unit;
    return {loadAll:unit.loadAll.bind(unit),async putRecord(...args){
      if(failWrites){writeAttempts++;throw failure;}return unit.putRecord(...args);
    },async close(){unitClosed=true;await unit.close();}};
  };
  t.after(async()=>{
    releaseModels.resolve();releaseJob.resolve({status:'killed'});
    try {await plugin?.dispose();} finally {detach();kv.open=open;await f.close();process.off('unhandledRejection',onUnhandled);}
  });
  plugin=f.ctx.plugin(Plugin);await plugin.await();const service=f.ctx.get('dshBot'),human=service.policy.fromPeer(operator);
  const dispatch=(action,input)=>service.dispatch(human,{action,operationId:randomUUID(),input});
  const bot=await dispatch('bot.create',{name:'Original bot',cwd:f.dir,contact:{provider:'controlled',model:'model-a'}});
  const task=await dispatch('task.create',{botId:bot.botId,title:'Original task',goal:'Held original request',criteria:[]});
  const attempt=await dispatch('task.start',{taskId:task.taskId,expectedVersion:1});
  const group=await dispatch('group.create',{name:'Original group',botIds:[bot.botId],coordinatorBotId:bot.botId,rounds:1,maxRequests:2});
  const round=await dispatch('group.post',{groupId:group.groupId,text:'Held original group turn'});
  await eventually(()=>streams.length===2,'original task and group providers');
  const state=service.store.read(),groupSessionId=state.groups[group.groupId].rounds[round.roundId].channels[0];
  const originals=[attempt.sessionId,groupSessionId].map(id=>({id,agent:f.ctx.agents.get(id),session:f.ctx.sessions.get(id)}));
  const jobId=f.ctx.jobs.start({kind:'bash',owner:attempt.sessionId,label:'Original held producer',run(){return {cancel(){cancelledJobs++;},done:releaseJob.promise};}});
  // Mark the actual admitted identities uncertain while their original native resources remain alive.
  await service.store.transact({operationId:randomUUID(),action:'test.original-unknown'},draft=>{
    draft.attempts[attempt.attemptId].state='UNKNOWN';draft.tasks[task.taskId].state='UNKNOWN';
    draft.sessions[attempt.sessionId].state='UNKNOWN';draft.sessions[groupSessionId].state='UNKNOWN';
    draft.groups[group.groupId].rounds[round.roundId].state='UNKNOWN';return null;
  });
  const before=service.store.read();failWrites=true;
  await assert.rejects(service.store.transact({operationId:'original-failed-write',action:'test.storage-failure'},()=>null),error=>error===failure);
  assert.throws(()=>service.store.read(),{code:'recovery_required'});
  return {...f,service,profile,kv,before,attempt,task,group,round,groupSessionId,originals,streams,jobId,unhandled,
    get unitClosed(){return unitClosed},get writeAttempts(){return writeAttempts},get cancelledJobs(){return cancelledJobs},
    releaseModels(){releaseModels.resolve()},releaseJob(){releaseJob.resolve({status:'killed'})},
    async dispose(){const current=plugin;plugin=null;return current.dispose()},
    async reopen(){const scope=await openProfileScope(f.ctx),store=await PluginStore.open(kv,{namespace:scope.namespace});return {scope,store};}};
}

test('mounted plugin drains original native model and job resources while preserving fenced UNKNOWN evidence',async t=>{
  const f=await heldPlugin(t);let completed=false;
  const closing=f.dispose().then(()=>{completed=true;return {};},error=>{completed=true;return {error};});
  await eventually(()=>completed||f.streams.some(row=>row.signal.aborted),'shutdown cancellation');
  assert.equal(completed,false,'plugin shutdown must await the original live providers and background producer');
  assert.equal(f.unitClosed,false);assert.equal(f.streams.find(row=>row.sessionId===f.groupSessionId).signal.aborted,true);
  assert.equal(f.streams.every(row=>!row.finished),true);
  for(const original of f.originals){assert.equal(f.ctx.agents.get(original.id),original.agent);assert.equal(f.ctx.sessions.get(original.id),original.session);}
  f.releaseModels();await eventually(()=>f.cancelledJobs>0,'original background producer cancellation');
  assert.equal(f.ctx.jobs.get(f.jobId,f.attempt.sessionId).status,'stopping');
  assert.equal(completed,false,'a cancel request cannot substitute for producer completion');assert.equal(f.unitClosed,false);
  f.releaseJob();const result=await closing;assert.equal(result.error,undefined);
  assert.equal(f.unitClosed,true);assert.equal(f.streams.every(row=>row.finished&&row.signal.aborted),true);
  for(const original of f.originals)assert.equal(f.ctx.agents.get(original.id),undefined);
  assert.equal(f.ctx.jobs.list(f.attempt.sessionId).some(row=>row.id===f.jobId),false);
  assert.deepEqual(f.service.store.read({diagnostic:true}),f.before);assert.equal(f.writeAttempts,1);
  assert.equal(f.requests.length,2);assert.deepEqual(f.unhandled,[]);
  await assert.rejects(f.service.store.transact({operationId:'closed-write',action:'test.closed'},()=>null),{code:'disposed'});
  const reopened=await f.reopen();try {assert.deepEqual(reopened.store.read(),f.before);} finally {await reopened.store.close();await reopened.scope.close();}
  assert.equal(f.requests.length,2);assert.deepEqual(f.unhandled,[]);
});

test('mounted plugin continues native cleanup after an earlier controller close rejects',async t=>{
  const f=await heldPlugin(t),failure=Object.assign(Error('original controller cleanup error'),{code:'controller_close_failed'});
  let nativeCleanup=0;
  f.service.collaboration.close=async()=>{throw failure;};
  const adapterClose=f.service.adapter.close.bind(f.service.adapter);
  f.service.adapter.close=async()=>{nativeCleanup++;return adapterClose();};
  let completed=false;const closing=f.dispose().then(()=>{completed=true;return {};},error=>{completed=true;return {error};});
  await eventually(()=>completed||f.streams.some(row=>row.signal.aborted),'remaining native cleanup');
  assert.equal(completed,false,'an earlier cleanup error must not skip held native resources');assert.equal(f.unitClosed,false);
  f.releaseModels();await eventually(()=>f.cancelledJobs>0,'original producer cancellation');
  assert.equal(completed,false);f.releaseJob();const result=await closing;
  assert.equal(nativeCleanup,1);assert.equal(result.error,undefined);
  // Official Cordis consumes disposer rejections and reports the original error to its logger.
  assert.equal(f.ctx.logger.buffer.some(row=>row.type==='error'&&row.args.includes(failure)),true);
  for(const original of f.originals)assert.equal(f.ctx.agents.get(original.id),undefined);
  assert.equal(f.streams.every(row=>row.finished&&row.signal.aborted),true);
  assert.equal(f.ctx.jobs.list(f.attempt.sessionId).some(row=>row.id===f.jobId),false);
  assert.deepEqual(f.service.store.read({diagnostic:true}),f.before);assert.equal(f.writeAttempts,1);assert.equal(f.requests.length,2);assert.deepEqual(f.unhandled,[]);
  const reopened=await f.reopen();try {assert.deepEqual(reopened.store.read(),f.before);} finally {await reopened.store.close();await reopened.scope.close();}
});
