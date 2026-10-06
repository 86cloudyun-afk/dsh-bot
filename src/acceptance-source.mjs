/** Bind a prepared quality input to trusted sanitized evidence and its actual runtime bytes. */
import { createHash } from 'node:crypto';
import { dirname,isAbsolute,join,normalize } from 'node:path';
import { canonical,digest,requireValue } from './errors.mjs';
const sourceNames=['summary','runtimeIdentity','template'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const validHash=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
function readSources(sources){
 const records={},values={};
 for(const name of sourceNames){const source=sources?.[name];
  requireValue(typeof source?.path==='string' && isAbsolute(source.path) && normalize(source.path)===source.path && Buffer.isBuffer(source.bytes),'candidate_source_invalid');
  try{values[name]=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(source.bytes));}catch{requireValue(false,'candidate_source_invalid');}
  requireValue(values[name] && Object.getPrototypeOf(values[name])===Object.prototype,'candidate_source_invalid');
  records[name]={path:source.path,sha256:hash(source.bytes)};
 }
 return {records,values};
}
function scopeOf(summary){
 requireValue(summary.verdict==='PASS_SCOPED_ACTUAL_CLI_RECOVERY_SYNTHETIC_PROVIDER'
  && summary.remoteProvider==='synthetic auth/response; actual official CLI/Loader/AgentLoop/SQLite/JSONL/OS processes'
  && summary.realProviderRequestsThisStage===0 && summary.sigkillFinalIoExitProof==='UNCONFIRMED' && summary.fullOsDescriptorCleanupProven===false
  && summary.unknownReservationsUsageNullAndOriginalIdsPreserved===true && summary.knownNativeReceiptsAndUsagePreserved===true && summary.resumeReplayDispatches===0
  && summary.releaseOrPushOrProductionChange===false && summary.quality?.twoOldGuideFailuresPreserved===true && summary.quality.contentQualityPassed===false
  && summary.history?.correctedRealCalls===4 && summary.history.combinedRealCalls===6 && summary.history.unknownOperations===3
  && summary.history.knownSettledTokenSubtotal===2850 && summary.history.subtotalIsTotalBilling===false && summary.history.replayed===false,'candidate_scope_unsupported');
 return {providerEvidence:'synthetic_external_provider',nativeEvidence:'actual_cli_native_process_recovery',realProviderRequests:0,
  sigkillFinalIoExitProof:'UNCONFIRMED',fullOsCleanupProven:false,oldGuideFailuresPreserved:true,unknownPreserved:true};
}
function facts(summary){
 scopeOf(summary);
 const r=summary.regression;
 for(const number of [r?.nativeCore,r?.productNative,r?.productControls,summary.actualCliCases,summary.actualCliPassed,summary.independentFinalCases,summary.independentFinalPassed])
  requireValue(Number.isSafeInteger(number) && number>0,'candidate_source_invalid');
 requireValue(summary.actualCliPassed===summary.actualCliCases && summary.independentFinalPassed===summary.independentFinalCases
  && r.strictProtectedTypes==='PASS' && typeof summary.docs?.fullGate==='string' && /^\d+\/\d+ passed$/.test(summary.docs.fullGate),'candidate_source_invalid');
 const docs=summary.docs.fullGate.replace(' passed','');
 return `脱敏验收摘要（当前）：前序冻结恢复验收事实：官方固定CLI+私有overlay；CLI/Loader/AgentLoop/SQLite/JSONL/OS进程真实，外部provider auth/response合成，本阶段API0，不代表真实DeepSeek或内容质量PASS。回归core${r.nativeCore}、product native${r.productNative}、control${r.productControls}及protected严格类型通过；最终CLI${summary.actualCliPassed}/${summary.actualCliCases}、独立最终${summary.independentFinalPassed}/${summary.independentFinalCases}；上述恢复结论属于前序runtime，本候选执行overlay的P0-A来源门另验。文档full ${docs}，${summary.docs.status==='PASS'?'全量通过':'其余门禁未通过'}。有效native receipt/usage保持；unknown/null usage/预留与原ID保持，恢复重放0；SIGKILL最终IO为UNCONFIRMED，未证明全部OS清理。历史corrected4/combined6真实调用、3unknown、known settled subtotal2850（非总账单）不变，未重放；两份旧指南仍FAIL，无新内容PASS。publicHumanAuthorityVerified=false；动态模型/公共入口/完整协作未验收。`;
}
function artifactIdentity(identity,records,observed){
 requireValue(identity.format===1 && identity.officialDshVersion==='0.2.0-rc.2' && typeof identity.newRuntime==='string' && isAbsolute(identity.newRuntime),'candidate_source_invalid');
 const overlays={};
 for(const label of ['product','core']){const patch=identity.sourcePatches?.[label];
  requireValue(patch && typeof patch.path==='string' && patch.path===patch.path.split('/').at(-1) && validHash(patch.sha256)
   && /^[a-f0-9]{40}$/.test(patch.baseHead??'') && /^[a-f0-9]{40}$/.test(patch.baseTree??'') && patch.workingTree===true,'candidate_source_invalid');
  overlays[label]={...patch,path:join(dirname(records.runtimeIdentity.path),patch.path)};
  requireValue(observed?.overlays?.[label]?.path===overlays[label].path && observed.overlays[label].sha256===patch.sha256,'candidate_artifact_changed');
 }
 const runtime={directory:identity.newRuntime,
  launcher:{path:join(identity.newRuntime,'node_modules/@deepseek-ai/dsh/lib/bin.js'),sha256:identity.officialLauncherSha256},
  native:{path:join(identity.newRuntime,'node_modules/@deepseek-ai/dsh-experimental-native-run/lib/index.js'),sha256:identity.nativeBuiltEntrySha256},
  owner:{path:join(identity.newRuntime,'node_modules/dsh-bot/src/owner-app.mjs'),sha256:identity.productRuntimeSourceHashes?.['src/owner-app.mjs']},
  controller:{path:join(identity.newRuntime,'node_modules/dsh-bot/src/native-controller.mjs'),sha256:identity.productRuntimeSourceHashes?.['src/native-controller.mjs']}};
 for(const name of ['launcher','native','owner','controller'])requireValue(validHash(runtime[name].sha256),'candidate_source_invalid');
 requireValue(canonical(observed?.runtime ?? null)===canonical(runtime),'candidate_artifact_changed');
 return {officialDshVersion:identity.officialDshVersion,overlays,runtime};
}
/** Produce PREPARED_NOT_SENT input. Sources are trusted caller-selected paths/raw bytes; artifacts are measured hashes. */
export function prepareCandidate(template,sources,observedArtifacts){
 const {records,values}=readSources(sources);requireValue(canonical(template)===canonical(values.template),'candidate_source_invalid');
 const scope=scopeOf(values.summary),runtimeOverlay=artifactIdentity(values.runtimeIdentity,records,observedArtifacts);
 const p=template.requestPolicy;
 requireValue(template.state==='PREPARED_NOT_SENT' && template.realApiRequests===0 && p?.requestCount===1 && p.maxAttempts===1 && p.retries===0
  && Array.isArray(p.modelTools) && p.modelTools.length===0 && p.provider==='deepseek-official' && p.model==='deepseek-flash' && p.reasoning==='off' && p.maxOutputTokens===2048,'candidate_source_invalid');
 const input=template.modelInput?.text,start='\n脱敏验收摘要（当前）：',end='\n任务：';
 requireValue(typeof input==='string' && input.split(start).length===2 && input.split(end).length===2 && input.indexOf(start)<input.indexOf(end),'candidate_source_invalid');
 const currentFacts=facts(values.summary),text=input.slice(0,input.indexOf(start))+'\n'+currentFacts+input.slice(input.indexOf(end));
 requireValue(Buffer.byteLength(text)<=4096,'candidate_input_too_large');
 const binding={schema:1,sources:records,scope,runtimeOverlay};
 const candidate={...structuredClone(template),state:'PREPARED_NOT_SENT',realApiRequests:0,
  modelInput:{text,utf8Bytes:Buffer.byteLength(text)},currentFactBlock:currentFacts,
  currentSanitizedSummary:{source:records.summary.path,sha256:records.summary.sha256,runtimeIdentitySource:records.runtimeIdentity.path,scope},
  factBinding:{...binding,sourceVersion:digest(binding)}};
 return candidate;
}
/** Recheck current evidence and return the exact validated text/frame; no provider, permission or dispatch is created. */
export function verifyCandidate(candidate,sources,observedArtifacts){
 requireValue(candidate?.factBinding?.schema===1,'candidate_unbound');
 const {values}=readSources(sources),expected=prepareCandidate(values.template,sources,observedArtifacts);
 requireValue(canonical(candidate.factBinding.sources)===canonical(expected.factBinding.sources),'candidate_source_changed');
 requireValue(canonical(candidate.factBinding)===canonical(expected.factBinding),'candidate_source_changed');
 requireValue(canonical(candidate)===canonical(expected),'candidate_input_changed');
 const prepareFrame=Object.freeze({command:'prepare',operationId:'quality-single-candidate',kind:'execution',text:expected.modelInput.text});
 requireValue(Buffer.byteLength(JSON.stringify(prepareFrame)+'\n')<=8192,'candidate_input_too_large');
 return Object.freeze({text:prepareFrame.text,prepareFrame,sourceVersion:expected.factBinding.sourceVersion,realApiRequests:0,state:'VERIFIED_NOT_SENT'});
}
