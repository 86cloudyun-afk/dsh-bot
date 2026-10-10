import test from 'node:test';
import assert from 'node:assert/strict';
import SandboxPolicy,{setSandboxMode} from '@deepseek-ai/dsh-sandbox-policy';
import Approval,{setApprovalPolicy} from '@deepseek-ai/dsh-user-approval';
import {taskFixture} from './task-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

const command=(action,input)=>({action,input,operationId:crypto.randomUUID()});

for(const [initialMode,laterMode] of [['read-only','workspace-write'],['workspace-write','read-only']])
test(`managed child retains ${initialMode} while parent changes to ${laterMode} during native creation`,async t=>{
  const runGate=deferred(),createGate=deferred();let restoreCreate;
  t.after(()=>{createGate.resolve();runGate.resolve();restoreCreate?.();});
  const f=await taskFixture(t,{stream:async function*(){await runGate.promise;yield*textChunks('Controlled native delegated policy reply');}});
  await f.ctx.plugin(SandboxPolicy,{mode:'read-only',workspaceRoot:f.dir}).await();
  await f.ctx.plugin(Approval,{policy:'ask'}).await();
  const bot=await f.bot('DelegatedPolicy'),parent=await f.task(bot,'DelegatingParent');
  const root=await f.tasks.start(f.human,command('task.start',{taskId:parent.taskId,expectedVersion:1}));
  await eventually(()=>f.requests.length===1);
  const parentAgent=f.ctx.agents.get(root.sessionId);
  setSandboxMode(parentAgent.session,initialMode);setApprovalPolicy(parentAgent.session,'ask');
  const persistence=f.ctx.sessionPersistence,originalCreate=persistence.create;
  let creatingHeader;
  persistence.create=async function(header,...args){
    if(header.parentSession===root.sessionId){creatingHeader=header;await createGate.promise;}
    return originalCreate.call(this,header,...args);
  };
  restoreCreate=()=>{persistence.create=originalCreate;};
  const child=await f.task(bot,'DelegatedChild');
  const launched=f.tasks.start(f.human,command('task.start',{taskId:child.taskId,expectedVersion:1,parentAttemptId:root.attemptId}));
  await eventually(()=>creatingHeader,'native child persistence creation');
  setSandboxMode(parentAgent.session,laterMode);
  createGate.resolve();const attempt=await launched;
  await eventually(()=>f.requests.length===2);
  const childAgent=f.ctx.agents.get(attempt.sessionId),native=await f.adapter.inspectSession(attempt.sessionId);
  const delegated=native.events.filter(event=>event.type==='sandbox/mode'&&event.data.source==='delegation');
  assert.deepEqual(delegated.map(event=>event.data.mode),[initialMode],'the durable child policy must be captured before native creation awaits');
  assert.equal(f.ctx.sandboxPolicy.resolve({session:childAgent.session}).mode,initialMode);
  assert.equal(f.ctx.sandboxPolicy.resolve({session:parentAgent.session}).mode,laterMode);
  assert.equal(f.ctx.sandboxPolicy.resolve({session:childAgent.session}).workspaceRoot,native.header.cwd);
  assert.equal(f.ctx.approval.effectivePolicy(childAgent.session),'never');
  assert.equal(f.ctx.approval.effectivePolicy(parentAgent.session),'ask');
  assert.ok(native.events.some(event=>event.type==='approval/policy'&&event.data.source==='delegation'&&event.data.policy==='never'));
  assert.equal(native.header.parentSession,root.sessionId);assert.equal(native.header.delegationDepth,1);
  assert.ok(native.events.some(event=>event.type==='subagent/descriptor'&&event.data.mode==='one-shot'));
  assert.equal(attempt.sessionId,creatingHeader.id);assert.equal(f.requests.length,2);
  runGate.resolve();await eventually(()=>[root,attempt].every(row=>!f.store.read().attempts[row.attemptId].reservationHeld));
  const settled=await f.adapter.inspectSession(attempt.sessionId);
  assert.deepEqual(settled.events.filter(event=>event.type==='sandbox/mode'&&event.data.source==='delegation').map(event=>event.data.mode),[initialMode]);
});
