import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
let api={};try{api=await import('../src/acceptance-source.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const summary={format:1,verdict:'PASS_SCOPED_ACTUAL_CLI_RECOVERY_SYNTHETIC_PROVIDER',actualCliCases:8,actualCliPassed:8,independentFinalCases:3,independentFinalPassed:3,
  remoteProvider:'synthetic auth/response; actual official CLI/Loader/AgentLoop/SQLite/JSONL/OS processes',realProviderRequestsThisStage:0,
  knownNativeReceiptsAndUsagePreserved:true,unknownReservationsUsageNullAndOriginalIdsPreserved:true,resumeReplayDispatches:0,
  sigkillFinalIoExitProof:'UNCONFIRMED',fullOsDescriptorCleanupProven:false,regression:{nativeCore:59,productNative:52,productControls:104,strictProtectedTypes:'PASS'},
  docs:{fullGate:'40/43 passed',status:'FAIL_3_NAMED_GATES'},quality:{twoOldGuideFailuresPreserved:true,contentQualityPassed:false},
  history:{correctedRealCalls:4,combinedRealCalls:6,unknownOperations:3,knownSettledTokenSubtotal:2850,subtotalIsTotalBilling:false,replayed:false},releaseOrPushOrProductionChange:false};
 const identity={format:1,newRuntime:'/trusted/runtime',officialDshVersion:'0.2.0-rc.2',officialLauncherSha256:'a'.repeat(64),nativeBuiltEntrySha256:'b'.repeat(64),
  sourcePatches:{product:{path:'product.patch',sha256:'c'.repeat(64),baseHead:'1'.repeat(40),baseTree:'2'.repeat(40),workingTree:true},core:{path:'core.patch',sha256:'d'.repeat(64),baseHead:'3'.repeat(40),baseTree:'4'.repeat(40),workingTree:true}},
  productRuntimeSourceHashes:{'src/owner-app.mjs':'e'.repeat(64),'src/native-controller.mjs':'f'.repeat(64)}};
 const template={format:1,state:'PREPARED_NOT_SENT',realApiRequests:0,requestPolicy:{requestCount:1,maxAttempts:1,retries:0,modelTools:[],provider:'deepseek-official',model:'deepseek-flash',reasoning:'off',maxOutputTokens:2048},
  modelInput:{text:'模式绑定说明：创建Session时绑定，不授权限。\n脱敏验收摘要（当前）：core56/native46+4，总50复跑中。\n任务：恰好八项完整计划，不编造命令。'}};
 const sources={summary:{path:'/trusted/summary.json',bytes:Buffer.from(JSON.stringify(summary))},runtimeIdentity:{path:'/trusted/runtime-identity.json',bytes:Buffer.from(JSON.stringify(identity))},template:{path:'/trusted/template.json',bytes:Buffer.from(JSON.stringify(template))}};
 const artifacts={overlays:{product:{path:'/trusted/product.patch',sha256:identity.sourcePatches.product.sha256},core:{path:'/trusted/core.patch',sha256:identity.sourcePatches.core.sha256}},
  runtime:{directory:identity.newRuntime,launcher:{path:identity.newRuntime+'/node_modules/@deepseek-ai/dsh/lib/bin.js',sha256:identity.officialLauncherSha256},native:{path:identity.newRuntime+'/node_modules/@deepseek-ai/dsh-experimental-native-run/lib/index.js',sha256:identity.nativeBuiltEntrySha256},
   owner:{path:identity.newRuntime+'/node_modules/dsh-bot/src/owner-app.mjs',sha256:identity.productRuntimeSourceHashes['src/owner-app.mjs']},controller:{path:identity.newRuntime+'/node_modules/dsh-bot/src/native-controller.mjs',sha256:identity.productRuntimeSourceHashes['src/native-controller.mjs']}}};
 return {summary,identity,template,sources,artifacts};
}
function prepare(f){assert.equal(typeof api.prepareCandidate,'function');return api.prepareCandidate(f.template,f.sources,f.artifacts);}
function replace(f,name,value){f.sources[name].bytes=Buffer.from(JSON.stringify(value));}
test('current facts derive from authoritative bytes and bind uncommitted overlay outside model text',()=>{
 const f=fixture(),candidate=prepare(f),verified=api.verifyCandidate(candidate,f.sources,f.artifacts);
 assert.equal(candidate.state,'PREPARED_NOT_SENT');assert.match(verified.text,/core59.*native52.*control104/);assert.match(verified.text,/40\/43/);
 assert.match(verified.text,/UNCONFIRMED/);assert.match(verified.text,/2850.*非.*总/);assert.doesNotMatch(verified.text,/core56|总50复跑中/);
 assert.equal(verified.text.split('\n')[0],f.template.modelInput.text.split('\n')[0]);assert.ok(verified.text.endsWith('\n任务：恰好八项完整计划，不编造命令。'));
 assert.equal(verified.prepareFrame.text,verified.text);assert.equal(verified.prepareFrame.kind,'execution');
 assert.equal(candidate.factBinding.sources.summary.sha256,sha(f.sources.summary.bytes));assert.match(candidate.factBinding.sourceVersion,/^[a-f0-9]{64}$/);
 assert.doesNotMatch(verified.text,/\/trusted\/|[a-f0-9]{64}/);assert.equal(verified.realApiRequests,0);
});
test('legacy prepared candidate with schema format1 and base commit still lacks fact binding',()=>{const f=fixture();prepare(f);assert.throws(()=>api.verifyCandidate(f.template,f.sources,f.artifacts),{code:'candidate_unbound'});});
test('frozen recovery facts cannot claim the new source-guard overlay passed historical recovery',()=>{
 const f=fixture(),c=prepare(f);assert.match(c.currentFactBlock,/前序冻结恢复验收事实/);assert.match(c.currentFactBlock,/属于前序runtime/);assert.match(c.currentFactBlock,/执行overlay.*另验/);
});
test('replaced source bytes invalidate candidate even when counts stay identical',()=>{const f=fixture(),c=prepare(f);f.summary.extra='different source bytes';replace(f,'summary',f.summary);assert.throws(()=>api.verifyCandidate(c,f.sources,f.artifacts),{code:'candidate_source_changed'});});
test('same source bytes at different trusted path invalidate candidate',()=>{const f=fixture(),c=prepare(f);f.sources.summary.path='/other/summary.json';assert.throws(()=>api.verifyCandidate(c,f.sources,f.artifacts),{code:'candidate_source_changed'});});
for(const [name,change] of [
 ['real provider scope',s=>{s.remoteProvider='actual remote DeepSeek and full product PASS';}],
 ['unconfirmed cleanup promotion',s=>{s.sigkillFinalIoExitProof='CONFIRMED';}],
 ['full OS cleanup claim',s=>{s.fullOsDescriptorCleanupProven=true;}],
 ['unknown erasure',s=>{s.history.unknownOperations=0;}],
 ['old guide FAIL erasure',s=>{s.quality.twoOldGuideFailuresPreserved=false;}],
 ['total billing promotion',s=>{s.history.subtotalIsTotalBilling=true;}],
])test(`new generation rejects unsupported ${name}`,()=>{const f=fixture();prepare(f);change(f.summary);replace(f,'summary',f.summary);assert.throws(()=>api.prepareCandidate(f.template,f.sources,f.artifacts),{code:'candidate_scope_unsupported'});});
test('runtime manifest replacement invalidates candidate without changing base HEAD',()=>{const f=fixture(),c=prepare(f);f.identity.extra='new overlay identity';replace(f,'runtimeIdentity',f.identity);assert.throws(()=>api.verifyCandidate(c,f.sources,f.artifacts),{code:'candidate_source_changed'});});
for(const kind of ['overlay','runtime'])test(`${kind} byte hashes must match current declared artifacts`,()=>{const f=fixture(),c=prepare(f);if(kind==='overlay')f.artifacts.overlays.product.sha256='0'.repeat(64);else f.artifacts.runtime.owner.sha256='0'.repeat(64);assert.throws(()=>api.verifyCandidate(c,f.sources,f.artifacts),{code:'candidate_artifact_changed'});});
test('candidate text changes cannot retain a valid source binding',()=>{const f=fixture(),c=prepare(f);c.modelInput.text=c.modelInput.text.replace('core59','core999');assert.throws(()=>api.verifyCandidate(c,f.sources,f.artifacts),{code:'candidate_input_changed'});});
test('candidate self-reported source paths cannot choose verifier authority',()=>{const f=fixture(),c=prepare(f);c.factBinding.sources.summary.path='/other/fake.json';assert.throws(()=>api.verifyCandidate(c,f.sources,f.artifacts),{code:'candidate_source_changed'});});
test('template or request policy tampering rejects cached candidate',()=>{const f=fixture(),c=prepare(f);c.requestPolicy.retries=1;assert.throws(()=>api.verifyCandidate(c,f.sources,f.artifacts),{code:'candidate_input_changed'});});
test('malformed or missing authority fails without cached fallback',()=>{const f=fixture(),c=prepare(f);f.sources.summary.bytes=Buffer.from('{broken');assert.throws(()=>api.verifyCandidate(c,f.sources,f.artifacts),{code:'candidate_source_invalid'});delete f.sources.summary;assert.throws(()=>api.verifyCandidate(c,f.sources,f.artifacts),{code:'candidate_source_invalid'});});
