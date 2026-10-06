import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,createBot,createTask } from './helpers.mjs';
import { observe } from '../src/observations.mjs';
import { digest } from '../src/errors.mjs';
let api={};try{api=await import('../src/working-set.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
function build(input){assert.equal(typeof api.buildWorkingSet,'function');return api.buildWorkingSet(input);}
function setup(){
 const f=fixture(),bot=createBot(f),task=createTask(f,bot),plan=f.cmd('createProgressPlan',{taskId:task.taskId,steps:[{title:'Current next action',evidence:'Current artifact digest'}]},task.revision).result;
 const input={task,bot,plans:[plan],attempts:[],projections:[],nativeOperations:[],authorityEpoch:1,namespace:'P',phase:'dispatch',now:Date.parse('2026-10-05T10:00:00Z')};
 return {f,input,plan,close:()=>f.ledger.close()};
}
function evidence(s){
 const attempt={attemptId:'current-attempt',taskId:s.input.task.taskId,epoch:s.input.task.epoch,taskRevision:s.input.task.revision,botEpoch:s.input.bot.epoch,runGeneration:'g-current',execution:'settled'};
 const projection=observe(s.f.ledger,{eventId:'current-result',source:'trusted-offline-worker',entityId:attempt.attemptId,generation:'g-current',sourceSeq:1,state:'settled',observedAt:'2026-10-05T09:59:00Z'});
 const plan={...s.plan,steps:[{...s.plan.steps[0],state:'completed',attemptId:attempt.attemptId,completionEvidence:'HARMLESS_CURRENT_ARTIFACT'}]};
 return {attempt,projection,plan};
}
test('workset uses current task revision/acceptance and exact existing goal/cursor without mutating records',()=>{const s=setup();try{
 const before=JSON.stringify(s.input),w=build(s.input);assert.equal(w.context.task.revision,s.input.task.revision);assert.equal(w.context.task.acceptanceVersion,1);
 assert.equal(w.context.task.goalDigest,s.plan.goalDigest);assert.equal(w.context.progress.eventCursor,0);assert.equal(w.context.progress.nextStep.id,s.plan.nextStepId);
 assert.equal(w.context.status,'current');assert.equal(w.context.authority,'context-only');assert.equal(w.version,digest(w.context));assert.equal(JSON.stringify(s.input),before);
}finally{s.close();}});
test('workset renders its exact bounded context into an unchanged explicit input',()=>{const s=setup();try{
 const w=build(s.input);assert.equal(typeof api.renderWorkingSet,'function');const text=api.renderWorkingSet(w,'HARMLESS_INPUT');
 assert.equal(text,`DSH_WORKING_SET\n${w.text}\nEXPLICIT_INPUT\nHARMLESS_INPUT`);assert.ok(Buffer.byteLength(w.text)<=2048);
}finally{s.close();}});
test('current completed evidence exposes only digest and fresh projection coordinates',()=>{const s=setup();try{
 const e=evidence(s),w=build({...s.input,plans:[e.plan],attempts:[e.attempt],projections:[e.projection]});
 assert.equal(w.context.evidence.length,1);assert.equal(w.context.evidence[0].digest,digest('HARMLESS_CURRENT_ARTIFACT'));
 assert.equal(w.context.evidence[0].sourceSeq,1);assert.equal(w.context.evidence[0].generation,'g-current');assert.equal(w.context.evidence[0].state,'settled');
 assert.ok(!w.text.includes('HARMLESS_CURRENT_ARTIFACT'));
}finally{s.close();}});
test('stale task revision and acceptanceVersion exclude the old progress payload',()=>{const s=setup();try{
 for(const task of [{...s.input.task,revision:2},{...s.input.task,acceptanceVersion:2}]){
  const w=build({...s.input,task});assert.equal(w.context.status,'blocked');assert.ok(w.context.reasons.includes('progress_binding_stale'));assert.equal(w.context.progress,null);
  assert.ok(!w.text.includes('Current next action'));assert.equal(w.context.task.acceptanceVersion,task.acceptanceVersion);
 }
}finally{s.close();}});
test('unknown original IDs remain blocked even for older task revision and no evidence becomes settled',()=>{const s=setup();try{
 const w=build({...s.input,phase:'resume',attempts:[{attemptId:'old-unknown-worker',taskId:s.input.task.taskId,taskRevision:0,execution:'outcome_unknown'}],
  nativeOperations:[{taskId:s.input.task.taskId,operationId:'original-unknown',state:'unknown',native:{reservationHeld:true,usage:null}}]});
 assert.equal(w.context.status,'unknown');assert.equal(w.context.recovery,'inspect-original-only');assert.equal(w.context.unknown.count,2);
 assert.deepEqual(w.context.unknown.operationIds,['original-unknown']);assert.equal(w.context.unknown.reservations,'retain-recorded');assert.deepEqual(w.context.evidence,[]);
}finally{s.close();}});
test('elapsed existing observation deadline excludes evidence and blocks dispatch preparation',()=>{const s=setup();try{
 const e=evidence(s),plan={...e.plan,policySnapshot:{...e.plan.policySnapshot,observationDeadline:'2026-10-05T09:59:59Z'}},w=build({...s.input,plans:[plan],attempts:[e.attempt],projections:[e.projection]});
 assert.equal(w.context.status,'blocked');assert.ok(w.context.reasons.includes('observation_window_ended'));assert.deepEqual(w.context.evidence,[]);
}finally{s.close();}});
test('stale freshness, future observation and wrong run generation never supply usable evidence',()=>{const s=setup();try{
 const e=evidence(s);for(const projection of [{...e.projection,freshness:'stale'},{...e.projection,generation:'old-worker'},
  {...e.projection,observedAt:'2026-10-05T10:01:00Z'}]){
  const w=build({...s.input,plans:[e.plan],attempts:[e.attempt],projections:[projection]});assert.deepEqual(w.context.evidence,[]);
 }
}finally{s.close();}});
test('existing observe ignores late worker generation and workset keeps only current result digest',()=>{const s=setup();try{
 const e=evidence(s),projected=observe(s.f.ledger,{eventId:'late-worker',source:'trusted-offline-worker',entityId:e.attempt.attemptId,generation:'old-worker',sourceSeq:2,state:'failed',observedAt:'2026-10-05T09:59:30Z',privatePayload:'LATE_SECRET'});
 assert.deepEqual(projected,e.projection);const w=build({...s.input,plans:[e.plan],attempts:[e.attempt],projections:[projected]});
 assert.equal(w.context.evidence[0].generation,'g-current');assert.ok(!w.text.includes('LATE_SECRET'));
}finally{s.close();}});
test('cross-task and cross-namespace data never enter the authorized workset',()=>{const s=setup();try{
 const e=evidence(s),foreign={...e.plan,taskId:'foreign-task',steps:[{title:'FOREIGN_SCOPE_SECRET'}]},w=build({...s.input,
  plans:[e.plan,foreign],attempts:[e.attempt,{...e.attempt,attemptId:'foreign-worker',taskId:'foreign-task',privatePayload:'FOREIGN_SCOPE_SECRET'}],
  projections:[e.projection,{...e.projection,entityId:'foreign-worker',privatePayload:'FOREIGN_SCOPE_SECRET'}],nativeOperations:[{taskId:'foreign-task',operationId:'FOREIGN_SCOPE_SECRET',state:'unknown'}]});
 assert.ok(!w.text.includes('FOREIGN_SCOPE_SECRET'));assert.equal(w.context.unknown.count,0);assert.equal(w.context.evidence.length,1);
 assert.throws(()=>build({...s.input,namespace:'OTHER'}),{code:'working_set_scope_denied'});
}finally{s.close();}});
test('changed evidence/cursor changes frozen version without granting execution authority',()=>{const s=setup();try{
 const first=build(s.input),changed=build({...s.input,plans:[{...s.plan,eventCursor:1}]});assert.notEqual(first.version,changed.version);
 assert.equal(changed.context.authority,'context-only');assert.equal(s.f.ledger.list('nativeOperation').length,0);
}finally{s.close();}});
test('Unicode task excerpts and many authorized refs stay within a fixed small byte budget',()=>{const s=setup();try{
 const task={...s.input.task,title:'界'.repeat(500),acceptance:'界'.repeat(5000)},plan={...s.plan,goalDigest:digest({title:task.title,acceptance:task.acceptance})},w=build({...s.input,task,plans:[plan],nativeOperations:Array.from({length:30},(_,i)=>({taskId:task.taskId,operationId:'original-'+i,state:'unknown'}))});
 assert.ok(Buffer.byteLength(w.text)<=2048);assert.equal(w.context.unknown.count,30);assert.ok(w.context.unknown.operationIds.length<=2);
 assert.throws(()=>api.renderWorkingSet(w,'x'.repeat(4096)),{code:'invalid_native_input'});
}finally{s.close();}});
