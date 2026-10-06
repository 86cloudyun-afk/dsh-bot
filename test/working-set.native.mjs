import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek';
import { OwnedNativeController } from '../src/native-controller.mjs';
import { fixture,response,deferred } from './native-fixture.mjs';
import { observe } from '../src/observations.mjs';
import { digest } from '../src/errors.mjs';
import { buildWorkingSet,renderWorkingSet } from '../src/working-set.mjs';
const sha=text=>createHash('sha256').update(text).digest('hex');
function capture(){
 const requests=[],original=DeepSeekAdapter.prototype.prepareCall;
 DeepSeekAdapter.prototype.prepareCall=async function(...args){const call=await original.apply(this,args);return {...call,stream:options=>{
  requests.push({messages:structuredClone(options.messages),tools:options.tools,sessionId:options.sessionId,model:options.model});return call.stream(options);
 }};};return {requests,restore:()=>{DeepSeekAdapter.prototype.prepareCall=original;}};
}
const facts=p=>JSON.parse(p.steps[0].split('\n')[1]);
// Existing private Owner progression commands require absent human root. Seed only data, never a grant.
function plan(f){const row={planId:'fixture-existing-plan',taskId:f.task.taskId,taskRevision:f.task.revision,taskEpoch:f.task.epoch,
 botEpoch:f.bot.epoch,authorityEpoch:f.ledger.get('grant','native-owner').epoch,goalDigest:digest({title:f.task.title,acceptance:f.task.acceptance}),
 acceptanceVersion:f.task.acceptanceVersion,policySnapshot:f.ledger.get('config',f.bot.configVersion).autonomy,
 steps:[{stepId:'fixture-step',title:'Explicit current action',expectedEvidence:'Exact artifact digest',attemptId:null,completionEvidence:null,state:'pending'}],
 nextStepId:'fixture-step',eventCursor:0,epoch:1,revision:1,state:'planned',nativeExecutionVerified:false,fixtureOrigin:'synthetic-existing-record-only'};
 return f.ledger.put('progress',row.planId,row);}
function checkpoint(f,current){return f.ledger.put('progress',current.planId,{...current,eventCursor:1,revision:current.revision+1,state:'waiting_native'});}
function receipt(label,f,p,requests,wires){console.log('P1_SURFACE '+JSON.stringify({label,operationId:p.operationId,nativeOperationId:p.nativeOperationId,
 workingSetVersion:p.workingSetVersion,phase:p.workingSetPhase,inputSha256:sha(p.steps[0]),
 optionsLastUserSha256:sha(requests.at(-1).messages.at(-1).content[0].text),wireLastUserSha256:sha(wires.at(-1).messages.at(-1).content[0].text),
 actualNativeSessionId:requests.at(-1).sessionId,model:requests.at(-1).model,modelTools:0,syntheticProviderRequests:wires.length,realProviderRequests:0,
 revision:facts(p).task.revision,acceptanceVersion:facts(p).task.acceptanceVersion,eventCursor:facts(p).progress.eventCursor,namespace:facts(p).namespace}));}
test('P1 exact workset reaches actual GenerateOptions messages and wire on dispatch and explicit resume work',async()=>{
 const cap=capture(),wires=[];globalThis.fetch=async(_url,init)=>{wires.push(JSON.parse(init.body));return response('Harmless P1 fixture result');};
 const f=await fixture(OwnedNativeController,undefined,{workingSetEnabled:true});try{
  const originalPlan=plan(f),p=f.prepare('execution','HARMLESS_P1_DISPATCH');assert.equal(typeof p.workingSetVersion,'string');assert.equal(facts(p).phase,'dispatch');
  await f.controller.admit(f.caller,p.operationId);assert.equal((await f.controller.drive(f.caller,p.operationId)).state,'settled');
  assert.equal(cap.requests.at(-1).messages.at(-1).content[0].text,p.steps[0]);assert.equal(wires.at(-1).messages.at(-1).content[0].text,p.steps[0]);
  assert.equal(cap.requests.at(-1).tools,undefined);assert.equal(wires.at(-1).tools,undefined);receipt('dispatch-visible',f,p,cap.requests,wires);
  const before=structuredClone(f.controller.inspect(f.caller,p.operationId));
  checkpoint(f,originalPlan);
  await f.controller.close(f.caller);f.controller=f.open();await f.controller.open(f.caller,{...f.ids,create:false});
  assert.deepEqual(f.controller.inspect(f.caller,p.operationId),before);assert.equal(wires.length,1);
  assert.equal(f.controller.snapshot(f.caller).recoveryWorkingSets.execution.context.progress.eventCursor,1);
  const next=f.prepare('execution','HARMLESS_P1_EXPLICIT_RESUME');assert.equal(facts(next).phase,'resume');assert.equal(facts(next).progress.eventCursor,1);
  await f.controller.admit(f.caller,next.operationId);assert.equal((await f.controller.drive(f.caller,next.operationId)).state,'settled');
  assert.equal(cap.requests.at(-1).messages.at(-1).content[0].text,next.steps[0]);assert.equal(wires.at(-1).messages.at(-1).content[0].text,next.steps[0]);
  assert.equal(cap.requests.at(-1).sessionId,f.execution.sessionId);assert.equal(wires.length,2);receipt('resume-visible',f,next,cap.requests,wires);
 }finally{cap.restore();await f.close();}
});
test('P1 cursor change while synthetic auth waits is refused at final native boundary before fetch',async()=>{
 const entered=deferred(),auth=deferred();let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};
 const f=await fixture(OwnedNativeController,async()=>{entered.resolve();await auth.promise;return {headers:{}};},{workingSetEnabled:true});try{
  const current=plan(f),p=f.prepare();assert.equal(typeof p.workingSetVersion,'string');await f.controller.admit(f.caller,p.operationId);
  const work=f.controller.drive(f.caller,p.operationId);await entered.promise;
  checkpoint(f,current);
  auth.resolve();const result=await work;assert.equal(fetches,0);assert.notEqual(result.state,'settled');assert.equal(result.native.usage,null);assert.equal(result.native.reservationHeld,true);
  assert.equal(f.ledger.get('nativeOperation',p.operationId).workingSetVersion,p.workingSetVersion);
  console.log('P1_BOUNDARY '+JSON.stringify({label:'post-auth-cursor-refusal',realProviderRequests:0,syntheticFetches:0,operationId:p.operationId,reservationHeld:true,usage:null,state:result.state,errorCategory:result.errorCategory ?? result.native.failureCode}));
 }finally{auth.resolve();await f.close();}
});
test('P1 unknown recovery retains original operation/reservation and cannot replay or dispatch new work',async()=>{
 const entered=deferred();let fetches=0;globalThis.fetch=async(_url,init)=>{fetches++;entered.resolve();return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
 const f=await fixture(OwnedNativeController,undefined,{workingSetEnabled:true});try{
  plan(f);const p=f.prepare();assert.equal(typeof p.workingSetVersion,'string');await f.controller.admit(f.caller,p.operationId);
  const work=f.controller.drive(f.caller,p.operationId);await entered.promise;const stop=f.stop(p.operationId);await f.controller.stop(f.caller,stop.operationId);await work;
  const before=f.controller.inspect(f.caller,p.operationId);assert.equal(before.state,'unknown');assert.equal(before.native.reservationHeld,true);
  await f.controller.close(f.caller);f.controller=f.open();await f.controller.open(f.caller,{...f.ids,create:false});
  const recovery=f.controller.snapshot(f.caller).recoveryWorkingSets.execution;assert.equal(recovery.context.status,'unknown');assert.ok(recovery.context.unknown.operationIds.includes(p.operationId));
  assert.equal(recovery.context.recovery,'inspect-original-only');assert.equal((await f.controller.drive(f.caller,p.operationId)).state,'unknown');
  assert.throws(()=>f.prepare(),error=>['generation_stopped','outcome_unknown'].includes(error.code));assert.equal(fetches,1);
  const after=f.controller.inspect(f.caller,p.operationId);assert.deepEqual(after.native,before.native);assert.equal(after.operationId,p.operationId);
  console.log('P1_BOUNDARY '+JSON.stringify({label:'unknown-resume-no-replay',operationId:p.operationId,realProviderRequests:0,syntheticFetches:1,resumeReplay:0,usage:null,reservationHeld:true,state:after.state}));
 }finally{await f.close();}
});
test('P1 foreign worker/scope payload and ignored late generation never reach actual model text',async()=>{
 const cap=capture(),wires=[];globalThis.fetch=async(_url,init)=>{wires.push(JSON.parse(init.body));return response();};
 const f=await fixture(OwnedNativeController,undefined,{workingSetEnabled:true});try{
  const current=plan(f),a={attemptId:'current-worker',taskId:f.task.taskId,epoch:f.task.epoch,taskRevision:f.task.revision,botEpoch:f.bot.epoch,runGeneration:'current',execution:'settled'};
  f.ledger.put('attempt',a.attemptId,a);observe(f.ledger,{eventId:'current',source:'fixture-worker',entityId:a.attemptId,generation:'current',sourceSeq:1,state:'settled',observedAt:'2020-01-01T00:00:00Z'});
  observe(f.ledger,{eventId:'late',source:'fixture-worker',entityId:a.attemptId,generation:'old',sourceSeq:2,state:'failed',observedAt:'2020-01-01T00:00:01Z',payload:'LATE_WORKER_SECRET'});
  f.ledger.put('progress',current.planId,{...current,steps:[{...current.steps[0],attemptId:a.attemptId,completionEvidence:'CURRENT_ARTIFACT'}]});
  f.ledger.put('progress','foreign',{...current,planId:'foreign',taskId:'foreign-task',steps:[{title:'FOREIGN_SCOPE_SECRET'}]});
  f.ledger.put('attempt','foreign-worker',{...a,attemptId:'foreign-worker',taskId:'foreign-task',execution:'outcome_unknown',payload:'FOREIGN_SCOPE_SECRET'});
  const p=f.command('prepareNativeTextOperation',{kind:'execution',steps:['HARMLESS_CURRENT_SCOPE'],namespace:'foreign'}).result;
  assert.equal(typeof p.workingSetVersion,'string');assert.equal(facts(p).namespace,'private-review');assert.equal(facts(p).evidence.length,1);
  assert.equal(facts(p).evidence[0].generation,'current');await f.controller.admit(f.caller,p.operationId);await f.controller.drive(f.caller,p.operationId);
  const text=wires.at(-1).messages.at(-1).content[0].text;assert.equal(text,p.steps[0]);assert.ok(!text.includes('FOREIGN_SCOPE_SECRET'));assert.ok(!text.includes('LATE_WORKER_SECRET'));assert.ok(!text.includes('CURRENT_ARTIFACT'));
  receipt('scope-and-late-worker-exclusion',f,p,cap.requests,wires);
 }finally{cap.restore();await f.close();}
});
test('P1 expired observation window and changed acceptanceVersion refuse prepare without a native operation',async()=>{
 let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};const f=await fixture(OwnedNativeController,undefined,{workingSetEnabled:true});try{
  const current=plan(f);for(const changed of [{...current,acceptanceVersion:99},{...current,policySnapshot:{...current.policySnapshot,observationDeadline:'2020-01-01T00:00:00Z'}}]){
   f.ledger.put('progress',current.planId,changed);assert.throws(()=>f.prepare(),{code:'working_set_stale'});
  }assert.equal(fetches,0);assert.equal(f.ledger.list('nativeOperation').length,0);
 }finally{await f.close();}
});
test('P1 opt-in conflicts with exact acceptance guard before any new owned binding',async()=>{
 const f=await fixture(OwnedNativeController);try{
  assert.throws(()=>new OwnedNativeController({ctx:f.ctx,ledger:f.ledger,ownerLabel:'offline-runtime-owner',directory:f.directory+'/other-journal',capacity:{},workingSetEnabled:true,acceptanceGuard:()=> 'a'.repeat(64)}),{code:'working_set_guard_conflict'});
 }finally{await f.close();}
});
for(const fault of ['erase-binding','regenerate-product-only','forge-prepared-state'])test(`P1 final guard refuses ${fault} while original native input remains immutable`,async()=>{
 const entered=deferred(),auth=deferred();let fetches=0;globalThis.fetch=async()=>{fetches++;return response();};
 const f=await fixture(OwnedNativeController,async()=>{entered.resolve();await auth.promise;return {headers:{}};},{workingSetEnabled:true});try{
  const current=plan(f),p=f.prepare('execution','HARMLESS_BOUND_INPUT');await f.controller.admit(f.caller,p.operationId);
  const work=f.controller.drive(f.caller,p.operationId);await entered.promise;const advanced=checkpoint(f,current),stored=f.ledger.get('nativeOperation',p.operationId);
  if(fault==='erase-binding'){delete stored.workingSetVersion;delete stored.workingSetPhase;}
  else{const next=buildWorkingSet({task:f.task,bot:f.ledger.get('bot',f.bot.botId),plans:[advanced],attempts:[],projections:[],nativeOperations:[],
   authorityEpoch:f.ledger.get('grant','native-owner').epoch,namespace:'private-review',phase:'dispatch'});
   stored.steps=[renderWorkingSet(next,'HARMLESS_BOUND_INPUT')];stored.inputDigest=digest(stored.steps);stored.workingSetVersion=next.version;
   if(fault==='forge-prepared-state')stored.state='prepared';
  }
  f.ledger.put('nativeOperation',p.operationId,stored);auth.resolve();const result=await work;
  assert.equal(fetches,0);assert.notEqual(result.state,'settled');assert.equal(result.native.usage,null);assert.equal(result.native.reservationHeld,true);
  assert.deepEqual(result.native.steps,p.steps);assert.equal(result.operationId,p.operationId);
  console.log('P1_BOUNDARY '+JSON.stringify({label:fault,operationId:p.operationId,realProviderRequests:0,syntheticFetches:0,originalNativeInputPreserved:true,usage:null,reservationHeld:true,state:result.state}));
 }finally{auth.resolve();await f.close();}
});
for(const bothIds of [false,true])test(`P1 inspect of original key cannot borrow another settled operation: ${bothIds}`,async()=>{
 const entered=deferred(),auth=deferred();let authCalls=0,fetches=0;
 globalThis.fetch=async()=>{fetches++;return response('Harmless other operation fixture');};
 const f=await fixture(OwnedNativeController,async()=>{if(++authCalls>1){entered.resolve();await auth.promise;}return {headers:{}};},{workingSetEnabled:true});try{
  const current=plan(f);checkpoint(f,current);
  const other=f.prepare('execution','HARMLESS_ORIGINAL_INPUT');await f.controller.admit(f.caller,other.operationId);await f.controller.drive(f.caller,other.operationId);
  const otherBefore=structuredClone(f.controller.inspect(f.caller,other.operationId));assert.equal(otherBefore.state,'settled');assert.equal(fetches,1);
  // Synthetic fixture record rewind only; no production progress command or grant.
  f.ledger.put('progress',current.planId,current);
  const p=f.prepare('execution','HARMLESS_ORIGINAL_INPUT');await f.controller.admit(f.caller,p.operationId);
  const work=f.controller.drive(f.caller,p.operationId);await entered.promise;checkpoint(f,current);
  const original=structuredClone(f.ledger.get('nativeOperation',p.operationId));
  const substituted={...original,nativeOperationId:other.nativeOperationId,...bothIds?{operationId:other.operationId}:{},
   steps:other.steps,inputDigest:other.inputDigest,workingSetVersion:other.workingSetVersion,workingSetPhase:other.workingSetPhase};
  f.ledger.put('nativeOperation',p.operationId,substituted);auth.resolve();
  await assert.rejects(work,{code:'working_set_identity_changed'});
  assert.throws(()=>f.controller.inspect(f.caller,p.operationId),{code:'working_set_identity_changed'});
  assert.equal(fetches,1);assert.deepEqual(f.ledger.get('nativeOperation',other.operationId),otherBefore);
  assert.deepEqual(f.ledger.get('nativeOperation',p.operationId),substituted);
  // Restore only this intentionally corrupted fixture row to inspect the untouched authoritative original native journal.
  f.ledger.put('nativeOperation',p.operationId,original);const originalNative=f.controller.inspect(f.caller,p.operationId).native;
  assert.equal(originalNative.id,p.nativeOperationId);assert.equal(originalNative.usage,null);assert.equal(originalNative.reservationHeld,true);
  console.log('P1_BOUNDARY '+JSON.stringify({label:bothIds?'replace-both-identities':'replace-native-identity',operationId:p.operationId,
   originalNativeOperationId:p.nativeOperationId,realProviderRequests:0,syntheticOtherOperationFetches:1,syntheticOriginalOperationFetches:0,
   inspectErrorCategory:'working_set_identity_changed',originalNativeIdentityPreserved:true,otherOperationUnchanged:true,
   originalUsage:null,originalReservationHeld:true,fixtureIdentityRestoredForOriginalNativeInspection:true}));
 }finally{auth.resolve();await f.close();}
});
