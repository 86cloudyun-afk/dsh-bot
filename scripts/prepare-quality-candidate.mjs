/** Offline-only prepare/verify. Has no provider, run, network or authorization entry. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCandidate } from '../src/acceptance-source.mjs';
import { loadCandidateSources,verifyConfiguredCandidate } from '../src/acceptance-source-files.mjs';
export function prepareQualityFile(config,outputPath){
 const {sources,observedArtifacts}=loadCandidateSources(config),template=JSON.parse(sources.template.bytes.toString('utf8'));
 const candidate=prepareCandidate(template,sources,observedArtifacts);writeFileSync(outputPath,JSON.stringify(candidate,null,2)+'\n',{flag:'wx',mode:0o600});
 return verifyConfiguredCandidate({...config,candidatePath:outputPath});
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,...args]=process.argv.slice(2),config={};for(let i=0;i<args.length;i+=2)config[args[i].replace(/^--/,'')]=args[i+1];
 try{
  if(!['prepare','verify'].includes(action))throw Object.assign(Error('invalid_candidate_action'),{code:'invalid_candidate_action'});
  const result=action==='prepare'?prepareQualityFile(config,config.candidatePath):verifyConfiguredCandidate(config);
  console.log(JSON.stringify({state:'PREPARED_NOT_SENT',verifiedNotSent:true,sourceVersion:result.sourceVersion,textUtf8Bytes:Buffer.byteLength(result.text),frameUtf8Bytes:Buffer.byteLength(JSON.stringify(result.prepareFrame)+'\n'),realApiRequests:0}));
 }catch(error){console.error(JSON.stringify({errorCategory:typeof error.code==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(error.code)?error.code:'candidate_source_invalid',realApiRequests:0}));process.exitCode=1;}
}
