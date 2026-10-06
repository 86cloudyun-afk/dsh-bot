/** Read only caller-configured public evidence, patches and four runtime files; never use candidate paths as authority. */
import { readFileSync,realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname,join,isAbsolute } from 'node:path';
import { CommandError,requireValue } from './errors.mjs';
import { verifyCandidate } from './acceptance-source.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtimeNames=['launcher','native','owner','controller'];
/** Capture trusted executing module origins before startup awaits; never accept these paths from a candidate. */
export function observeExecutingRuntime(paths){
 try{return Object.fromEntries(runtimeNames.map(name=>{
  const path=paths?.[name];requireValue(typeof path==='string' && isAbsolute(path),'candidate_runtime_mismatch');
  return [name,Object.freeze({path:realpathSync(path),sha256:hash(readFileSync(path))})];
 }));}catch{throw new CommandError('candidate_runtime_mismatch');}
}
export function loadCandidateSources(config){
 try{
  const sources={};
  for(const name of ['summary','runtimeIdentity','template']){
   const path=config?.[name+'Path'];requireValue(typeof path==='string' && isAbsolute(path),'candidate_source_invalid');
   sources[name]={path:realpathSync(path),bytes:readFileSync(path)};
  }
  requireValue(typeof config.runtimeDirectory==='string' && isAbsolute(config.runtimeDirectory),'candidate_source_invalid');
  const runtimeDirectory=realpathSync(config.runtimeDirectory),identity=JSON.parse(sources.runtimeIdentity.bytes.toString('utf8'));
  const measured=path=>({path:realpathSync(path),sha256:hash(readFileSync(path))});
  const overlays={};
  for(const label of ['product','core']){
   const name=identity.sourcePatches?.[label]?.path;requireValue(typeof name==='string' && name===name.split('/').at(-1),'candidate_source_invalid');
   overlays[label]=measured(join(dirname(sources.runtimeIdentity.path),name));
  }
  const runtime={directory:runtimeDirectory,launcher:measured(join(runtimeDirectory,'node_modules/@deepseek-ai/dsh/lib/bin.js')),
   native:measured(join(runtimeDirectory,'node_modules/@deepseek-ai/dsh-experimental-native-run/lib/index.js')),
   owner:measured(join(runtimeDirectory,'node_modules/dsh-bot/src/owner-app.mjs')),controller:measured(join(runtimeDirectory,'node_modules/dsh-bot/src/native-controller.mjs'))};
  return {sources,observedArtifacts:{overlays,runtime}};
 }catch(error){if(error instanceof CommandError)throw error;throw new CommandError('candidate_source_invalid');}
}
export function verifyConfiguredCandidate(config,executingRuntime){
 const {sources,observedArtifacts}=loadCandidateSources(config);let candidate;
 if(executingRuntime!==undefined){
  const current=observeExecutingRuntime(Object.fromEntries(runtimeNames.map(name=>[name,executingRuntime[name]?.path])));
  for(const name of runtimeNames)requireValue(executingRuntime[name]?.path===observedArtifacts.runtime[name].path
   && executingRuntime[name]?.sha256===observedArtifacts.runtime[name].sha256
   && current[name].sha256===executingRuntime[name].sha256,'candidate_runtime_mismatch');
 }
 try{requireValue(typeof config.candidatePath==='string' && isAbsolute(config.candidatePath),'candidate_source_invalid');candidate=JSON.parse(readFileSync(config.candidatePath,'utf8'));}
 catch(error){if(error instanceof CommandError)throw error;throw new CommandError('candidate_source_invalid');}
 return verifyCandidate(candidate,sources,observedArtifacts);
}
