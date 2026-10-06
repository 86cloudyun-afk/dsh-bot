import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareCandidate } from '../src/acceptance-source.mjs';
import { loadCandidateSources } from '../src/acceptance-source-files.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function acceptanceFiles(directory){
 await mkdir(directory,{recursive:true});const runtime=join(directory,'runtime');
 const paths={launcher:'node_modules/@deepseek-ai/dsh/lib/bin.js',native:'node_modules/@deepseek-ai/dsh-experimental-native-run/lib/index.js',owner:'node_modules/dsh-bot/src/owner-app.mjs',controller:'node_modules/dsh-bot/src/native-controller.mjs'};
 const executing={};for(const [name,path] of Object.entries(paths)){const file=join(runtime,path);await mkdir(join(file,'..'),{recursive:true});await writeFile(file,`public ${name} fixture bytes`);executing[name]={path:file,sha256:sha(await readFile(file))};}
 const summary={verdict:'PASS_SCOPED_ACTUAL_CLI_RECOVERY_SYNTHETIC_PROVIDER',actualCliCases:8,actualCliPassed:8,independentFinalCases:3,independentFinalPassed:3,remoteProvider:'synthetic auth/response; actual official CLI/Loader/AgentLoop/SQLite/JSONL/OS processes',realProviderRequestsThisStage:0,knownNativeReceiptsAndUsagePreserved:true,unknownReservationsUsageNullAndOriginalIdsPreserved:true,resumeReplayDispatches:0,sigkillFinalIoExitProof:'UNCONFIRMED',fullOsDescriptorCleanupProven:false,regression:{nativeCore:59,productNative:52,productControls:104,strictProtectedTypes:'PASS'},docs:{fullGate:'40/43 passed'},quality:{twoOldGuideFailuresPreserved:true,contentQualityPassed:false},history:{correctedRealCalls:4,combinedRealCalls:6,unknownOperations:3,knownSettledTokenSubtotal:2850,subtotalIsTotalBilling:false,replayed:false},releaseOrPushOrProductionChange:false};
 const identity={format:1,newRuntime:runtime,officialDshVersion:'0.2.0-rc.2',officialLauncherSha256:executing.launcher.sha256,nativeBuiltEntrySha256:executing.native.sha256,productRuntimeSourceHashes:{'src/owner-app.mjs':executing.owner.sha256,'src/native-controller.mjs':executing.controller.sha256},sourcePatches:{}};
 for(const label of ['product','core']){const path=label+'.patch',bytes=Buffer.from('public '+label+' overlay');await writeFile(join(directory,path),bytes);identity.sourcePatches[label]={path,sha256:sha(bytes),baseHead:'1'.repeat(40),baseTree:'2'.repeat(40),workingTree:true};}
 const template={format:1,state:'PREPARED_NOT_SENT',realApiRequests:0,requestPolicy:{requestCount:1,maxAttempts:1,retries:0,modelTools:[],provider:'deepseek-official',model:'deepseek-flash',reasoning:'off',maxOutputTokens:2048},modelInput:{text:'Approved mode explanation.\n脱敏验收摘要（当前）：historical.\n任务：Harmless offline guide only.'}};
 const config={summaryPath:join(directory,'summary.json'),runtimeIdentityPath:join(directory,'runtime-identity.json'),templatePath:join(directory,'template.json'),runtimeDirectory:runtime,candidatePath:join(directory,'candidate.json')};
 await writeFile(config.summaryPath,JSON.stringify(summary));await writeFile(config.runtimeIdentityPath,JSON.stringify(identity));await writeFile(config.templatePath,JSON.stringify(template));
 const regenerate=async()=>{const {sources,observedArtifacts}=loadCandidateSources(config);const candidate=prepareCandidate(template,sources,observedArtifacts);await writeFile(config.candidatePath,JSON.stringify(candidate));return candidate;};
 const candidate=await regenerate();return {config,executing,summary,identity,candidate,regenerate};
}
