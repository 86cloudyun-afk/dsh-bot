import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Host } from '../src/host.mjs';
import { Ledger } from '../src/ledger.mjs';
import { digest } from '../src/errors.mjs';
import { guideAcceptancePayloads } from '../src/guide-acceptance.mjs';
import { guideInput } from './guide-fixture.mjs';
import { fixture,createBot,createTask } from './helpers.mjs';

function privateFixture(){
 const ledger=new Ledger(resolve(mkdtempSync(resolve(process.env.DSH_BOT_TEST_ROOT,'private-closure-')),'ledger.sqlite'));
 const caller=Object.freeze({}),host=new Host({ledger,ownerHumanId:'private-unit-owner',ownerCapability:caller});
 const grant=ledger.get('grant','native-owner');ledger.put('grant','native-owner',{...grant,epoch:7});
 const envelope=(name,payload,revision=null)=>({operationId:randomUUID(),nonce:randomUUID(),command:name,payloadDigest:digest(payload),expectedRevision:revision,
  expectedEpochs:{},rootHumanInstructionRef:'private-offline-fixture',authorizationRef:'native-owner',createdAt:new Date().toISOString(),deadline:null});
 const cmd=(name,payload={},revision=null)=>host.executeOwned(caller,envelope(name,payload,revision),payload).result;
 const bot=cmd('createBot',{name:'Private fixture',config:{contact:{provider:'synthetic',model:'model-A',reasoning:'off'}}});
 const task=cmd('createTask',{ownerBotId:bot.botId,title:'Bounded content',scope:{namespace:'private-fixture',writeResources:[]},acceptance:'Explicit content decision'});
 return {ledger,caller,host,envelope,cmd,bot,task,plan:()=>cmd('createProgressPlan',{taskId:task.taskId,steps:[{title:'Review content',evidence:'digest'}]},task.revision)};
}
test('private progress uses its existing invocation grant and never creates human root',()=>{
 const f=privateFixture();try{const before=f.ledger.get('grant','native-owner'),p=f.plan();
  assert.equal(p.authorizationRef,'native-owner');assert.equal(p.authorityEpoch,7);
  const next=f.cmd('advanceTask',{planId:p.planId,eventId:'manual-1',cursor:1,trigger:'authorized_check'},p.revision);
  assert.equal(next.state,'waiting_native');assert.equal(next.checkpoint.effectsIssued,false);assert.equal(next.retryCount,0);
  assert.equal(f.ledger.get('grant','root'),null);assert.deepEqual(f.ledger.get('grant','native-owner'),before);assert.equal(f.ledger.list('attempt').length,0);
 }finally{f.ledger.close();}
});
test('private content helper composes existing submit and accept with host provenance only',()=>{
 const f=privateFixture();try{const before=f.ledger.get('grant','native-owner'),p=guideAcceptancePayloads(guideInput({task:f.task,expectedAuthorityEpoch:7}));
  const submitted=f.cmd('submitTask',p.submitTask,p.expectedRevisions.submit),accepted=f.cmd('acceptTask',p.acceptTask,p.expectedRevisions.accept);
  assert.equal(submitted.submission.producer.kind,'host');assert.equal(submitted.submission.nativeExecutionVerified,false);
  assert.equal(accepted.responsibility,'verified');assert.equal(accepted.acceptanceCheck.actor.kind,'host');
  assert.equal(accepted.acceptanceCheck.taskRevision,submitted.revision);assert.equal(accepted.artifactDigest,p.artifactDigest);
  assert.deepEqual(f.ledger.get('grant','native-owner'),before);assert.equal(f.ledger.get('grant','root'),null);
 }finally{f.ledger.close();}
});
test('private submission stale grant epoch rejects transactionally with authority_conflict',()=>{
 const f=privateFixture();try{const p=guideAcceptancePayloads(guideInput({task:f.task,expectedAuthorityEpoch:6}));
  assert.throws(()=>f.cmd('submitTask',p.submitTask,1),{code:'authority_conflict'});
  assert.deepEqual(f.ledger.get('task',f.task.taskId),f.task);assert.equal(f.ledger.list('acceptance').length,0);
 }finally{f.ledger.close();}
});
test('private progress cannot borrow another grant at the same epoch or a stale epoch',()=>{
 const f=privateFixture();try{const p=f.plan(),payload={planId:p.planId,eventId:'bound',cursor:1,trigger:'authorized_check'};
  const g=f.ledger.get('grant','native-owner');f.ledger.put('grant','other',{...g,id:'other'});
  const e={...f.envelope('advanceTask',payload,p.revision),authorizationRef:'other'};
  assert.throws(()=>f.host.execute(g.actor,e,payload),{code:'unauthorized'});
  f.ledger.put('progress',p.planId,{...p,authorizationRef:'other'});
  assert.throws(()=>f.cmd('advanceTask',payload,p.revision),{code:'epoch_conflict'});
  f.ledger.put('progress',p.planId,p);f.ledger.put('grant','native-owner',{...g,epoch:8});
  assert.throws(()=>f.cmd('advanceTask',payload,p.revision),{code:'epoch_conflict'});
 }finally{f.ledger.close();}
});
test('private identity and revoked grant reject before content or progress mutation',()=>{
 const f=privateFixture();try{const p={taskId:f.task.taskId,artifactDigest:'a'.repeat(64),evidence:'manual',expectedAuthorityEpoch:7},e=f.envelope('submitTask',p,1);
  assert.throws(()=>f.host.executeOwned({},e,p),{code:'unsupported_host_identity'});
  assert.throws(()=>f.host.execute({kind:'human',id:'private-unit-owner'},e,p),{code:'unauthorized'});
  f.ledger.put('grant','native-owner',{...f.ledger.get('grant','native-owner'),active:false});
  assert.throws(()=>f.cmd('submitTask',p,1),{code:'unauthorized'});assert.throws(()=>f.plan(),{code:'unauthorized'});
  assert.deepEqual(f.ledger.get('task',f.task.taskId),f.task);assert.equal(f.ledger.list('progress').length,0);
 }finally{f.ledger.close();}
});
test('legacy human progress without authorizationRef remains root-bound',()=>{
 const f=fixture();try{const t=createTask(f,createBot(f)),p=f.cmd('createProgressPlan',{taskId:t.taskId,steps:[{title:'Legacy',evidence:'digest'}]},t.revision).result;
  const {authorizationRef,...legacy}=p;f.ledger.put('progress',p.planId,legacy);
  assert.equal(f.cmd('advanceTask',{planId:p.planId,eventId:'legacy',cursor:1,trigger:'user'},p.revision).result.state,'waiting_native');
 }finally{f.ledger.close();}
});
test('progress observes unknown on its existing native target without issuing effects',()=>{
 const f=privateFixture();try{const p=f.plan(),op={operationId:'original-unit-id',targetId:'bound-unit-target',state:'unknown',native:{usage:null,reservationHeld:true}};
  f.ledger.put('nativeBinding','protected-text-owner',{targets:{execution:{product:{taskId:f.task.taskId},target:{id:'bound-unit-target'}}}});
  f.ledger.put('nativeOperation',op.operationId,op);
  const r=f.cmd('advanceTask',{planId:p.planId,eventId:'unknown',cursor:1,trigger:'authorized_check'},p.revision);
  assert.equal(r.state,'reconciling_unknown');assert.equal(r.checkpoint.effectsIssued,false);assert.equal(r.retryCount,0);
  assert.deepEqual(f.ledger.get('nativeOperation',op.operationId),op);
 }finally{f.ledger.close();}
});
