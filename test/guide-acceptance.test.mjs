import test from 'node:test';
import assert from 'node:assert/strict';
import { guideText,guideInput,textSha,knownExecution } from './guide-fixture.mjs';
import { readFileSync } from 'node:fs';
let api;try{api=await import('../src/guide-acceptance.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;api={};}
function run(input){assert.equal(typeof api.guideAcceptancePayloads,'function','Thin existing-acceptance payload helper must exist');return api.guideAcceptancePayloads(input);}
test('complete eight-item guide with digest-bound semantic approval builds existing acceptance payloads',()=>{
 const input=guideInput(),before=structuredClone(input),r=run(input);assert.deepEqual(input,before);
 assert.equal(r.artifactDigest,textSha(guideText));assert.equal(r.content.outcome,'passed');assert.equal(r.overallOutcome,'passed');
 assert.deepEqual(r.acceptTask,{taskId:input.task.taskId,artifactDigest:textSha(guideText),acceptanceVersion:3,outcome:'passed'});
 assert.equal(r.submitTask.expectedAuthorityEpoch,4);assert.equal(r.submitTask.artifactDigest,r.artifactDigest);assert.deepEqual(r.expectedRevisions,{submit:2,accept:3});
 assert.equal(r.execution.state,'KNOWN_SETTLED');assert.equal(r.execution.reservationHeld,false);
});
test('lexical and structural success alone cannot pass content without explicit semantic approval',()=>{
 for(const verdict of [undefined,{outcome:'inconclusive',artifactDigest:textSha(guideText),acceptanceVersion:3}]){
  const r=run(guideInput({semanticVerdict:verdict}));assert.equal(r.content.outcome,'inconclusive');assert.equal(r.acceptTask.outcome,'inconclusive');assert.equal(r.overallOutcome,'inconclusive');}
});
test('semantic verdict is bound to exact artifact bytes and acceptance version',()=>{
 for(const semanticVerdict of [{outcome:'passed',artifactDigest:'c'.repeat(64),acceptanceVersion:3},{outcome:'passed',artifactDigest:textSha(guideText),acceptanceVersion:2}])
  assert.equal(run(guideInput({semanticVerdict})).content.outcome,'inconclusive');
 const text=guideText+'\n';assert.notEqual(run(guideInput({text})).artifactDigest,textSha(guideText));
 for(const text of [guideText+' ',guideText.replace('Session创建','Ｓession创建')])assert.equal(run(guideInput({text,semanticVerdict:guideInput().semanticVerdict})).content.outcome,'inconclusive');
});
test('a ninth item or incomplete column cannot be approved by a semantic pass assertion',()=>{
 for(const text of [guideText+'\n9. extra｜condition｜evidence',guideText.replace('stdout状态。','')])
  assert.equal(run(guideInput({text})).content.outcome,'failed');
});
for(const [label,text] of [['mixed delimiter',guideText.replace('｜','|')],['pipe header',guideText+'\n动作｜条件｜证据'],['code fence','```text\n'+guideText+'\n```']])
 test(`approved guide format rejects ${label} despite a bound semantic pass`,()=>assert.equal(run(guideInput({text})).content.outcome,'failed'));
test('bare init and execution-role contact violate owner-guide prerequisites',()=>{
 for(const text of [guideText.replace('dsh --profile dsh-bot-owner --init','init'),guideText.replace('contact为独立联络Session','contact为独立执行会话')])
  assert.equal(run(guideInput({text})).content.outcome,'failed');
});
test('stop must distinguish unsent reservation release from sent unknown retention and remote cancellation',()=>{
 for(const text of [guideText.replace('未发送可释放未用预留；',''),guideText.replace('已发送无远端终态确认保持unknown与预留，abort/drain不证明远端停止','已发送请求已远端停止并释放预留')])
  assert.equal(run(guideInput({text})).content.outcome,'failed');
});
test('resume must retain original ID, unknown and reservation without replay',()=>{
 assert.equal(run(guideInput({text:guideText.replace('不重放，不清unknown，保留原ID与预留容量','自动重放并清除unknown')})).content.outcome,'failed');
});
test('output-limit truncation is inconclusive and never triggers retry',()=>{
 const r=run(guideInput({text:guideText.slice(0,-90),stopReason:'max_tokens'}));assert.equal(r.content.outcome,'inconclusive');assert.equal(r.overallOutcome,'inconclusive');assert.equal(r.acceptTask.outcome,'inconclusive');assert.ok(r.content.reasons.includes('output_truncated'));
 const complete=run(guideInput({stopReason:'max_tokens'}));assert.equal(complete.content.outcome,'inconclusive');assert.equal(complete.overallOutcome,'inconclusive');
});
test('explicit semantic failure remains content failure despite structural and native success',()=>{
 const r=run(guideInput({semanticVerdict:{outcome:'failed',artifactDigest:textSha(guideText),acceptanceVersion:3}}));assert.equal(r.content.outcome,'failed');assert.equal(r.execution.state,'KNOWN_SETTLED');assert.equal(r.overallOutcome,'failed');
});
test('native unknown or missing durable receipt cannot make an overall pass',()=>{
 for(const executionEvidence of [{...knownExecution(),state:'unknown',usage:null,receipt:null,reservationHeld:true,answers:['Everything passed.']},{...knownExecution(),receipt:null}]){
  const before=structuredClone(executionEvidence),r=run(guideInput({executionEvidence}));assert.deepEqual(executionEvidence,before);
  assert.equal(r.content.outcome,'passed');assert.equal(r.acceptTask.outcome,'passed');assert.equal(r.overallOutcome,'inconclusive');}
});
test('unknown execution stays unknown when content fails and answers claim success',()=>{
 const executionEvidence={...knownExecution(),state:'unknown',usage:null,receipt:null,reservationHeld:true,answers:['SUCCESS']};
 const r=run(guideInput({executionEvidence,automaticVerdict:'failed'}));assert.equal(r.content.outcome,'failed');assert.equal(r.execution.state,'UNKNOWN');assert.equal(r.execution.reservationHeld,true);
});
test('another settled output cannot supply this exact guide artifact overall acceptance',()=>{
 const r=run(guideInput({executionEvidence:{...knownExecution(),operationId:'other-operation',answers:['A different successful output.']}}));
 assert.equal(r.content.outcome,'passed');assert.equal(r.execution.state,'KNOWN_SETTLED');assert.equal(r.executionArtifactLinked,false);assert.equal(r.overallOutcome,'inconclusive');
});
test('both preserved historical failed guide texts remain content failures under the new thin helper',()=>{
 for(const name of ['guide-history-first.md','guide-history-second.md']){
  const text=readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');const input=guideInput({text});input.semanticVerdict.outcome='failed';
  assert.equal(run(input).content.outcome,'failed');}
});
