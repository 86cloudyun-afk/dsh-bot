/** Exclusively create a separate nonsecret DSH Home/profile; no install/network/auth operation. */
import { mkdir,readFile,writeFile,access,realpath } from 'node:fs/promises';
import { resolve,join,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const CORE='3fbedc25d3626caf4e401b14c31a7f0326a19ec7';
export async function installOwnerProfile({runtimeDirectory,homeDirectory}){
 if(typeof runtimeDirectory!=='string' || typeof homeDirectory!=='string' || !isAbsolute(runtimeDirectory) || !isAbsolute(homeDirectory))throw Error('ABSOLUTE_RUNTIME_HOME_REQUIRED');
 const runtime=await realpath(runtimeDirectory),home=resolve(homeDirectory),manifest=JSON.parse(await readFile(join(runtime,'owner-runtime-manifest.json'),'utf8'));
 if(await realpath(resolve(home,'..'))!==resolve(home,'..'))throw Error('CANONICAL_HOME_PARENT_REQUIRED');
 if(manifest.format!==1 || manifest.officialDshVersion!=='0.2.0-rc.2' || manifest.coreCandidate!==CORE)throw Error('OWNER_RUNTIME_MANIFEST_REQUIRED');
 await access(join(runtime,'node_modules','@deepseek-ai','dsh','lib','bin.js'));
 await mkdir(home,{mode:0o700});const directory=join(home,'profiles','dsh-bot-owner');await mkdir(directory,{recursive:true});
 const row=(id,name,config={})=>({id,name,inject:['dshBotOwnerStartup'],config});
 const rows=[{id:'owner-startup',name:'dsh-bot/owner-startup'},row('llm','@deepseek-ai/dsh-llm'),row('sessions','@deepseek-ai/dsh-session'),
  row('projections','@deepseek-ai/dsh-session-projection'),row('persistence','@deepseek-ai/dsh-session-persistence-jsonl',{root:join(home,'sessions'),compression:'none'}),
  row('prompt','@deepseek-ai/dsh-system-prompt',{personaPrefix:'',includeHarnessIdentity:false}),row('tools','@deepseek-ai/dsh-tools'),row('agents','@deepseek-ai/dsh-agent'),
  row('loop','@deepseek-ai/dsh-agent-loop',{agents:[]}),row('presets','@deepseek-ai/dsh-agent-preset-registry',{default:'owner/empty'}),
  row('preset','@deepseek-ai/dsh-agent-preset',{id:'owner/empty',plugins:[]}),row('protected-provider','dsh-bot/owner-protected-provider'),
  {...row('provider','@deepseek-ai/dsh-llm-deepseek-api-key',{apiKeyEnv:'DEEPSEEK_API_KEY',baseURL:'https://api.deepseek.com/anthropic',thinking:'disabled',reasoningEffort:'off',
    maxTokens:600,streamIdleTimeoutMs:30000,retryPolicy:{mode:'normal',maxRetries:0,backoff:{initialDelayMs:1,maxDelayMs:1,jitterRatio:0}}}),inject:['dshBotOwnerStartup','deepseekProtectedProviders']},
  row('owner-app','dsh-bot/owner-app',{homeDirectory:home,agentPreset:'owner/empty'})];
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'private-dsh-bot-owner-profile',private:true,type:'module',dsh:{profile:{bundles:[]}},dependencies:{}},null,2)+'\n');
 await writeFile(join(directory,'cordis.patch.yml'),JSON.stringify([{insert:rows}],null,2)+'\n');
 await writeFile(join(home,'owner-profile.json'),JSON.stringify({format:1,profile:'dsh-bot-owner',runtimeDirectory:runtime,homeDirectory:home,credentialsCreated:false,accessGrantCreated:false},null,2)+'\n');
 return {profile:'dsh-bot-owner',homeDirectory:home,dsh:join(runtime,'node_modules','.bin','dsh')};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i]]=process.argv[i+1];
 try{process.stdout.write(JSON.stringify(await installOwnerProfile({runtimeDirectory:options['--runtime'],homeDirectory:options['--home']}))+'\n');}
 catch(error){process.stderr.write(JSON.stringify({errorCategory:error.code ?? error.message})+'\n');process.exitCode=1;}
}
