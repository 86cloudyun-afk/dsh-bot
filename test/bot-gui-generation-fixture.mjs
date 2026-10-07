/** Actual GUI owner/SDK substrate with keyless synthetic SSE; no browser or remote-provider claim. */
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Context,symbols} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SessionStore from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import Presets from '@deepseek-ai/dsh-agent-preset-registry';
import Preset from '@deepseek-ai/dsh-agent-preset';
import Query from '@deepseek-ai/dsh-session-query';
import Controller from '@deepseek-ai/dsh-api-session-controller';
import {HostConnectionService} from '@deepseek-ai/dsh-client-connection';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Approval from '@deepseek-ai/dsh-user-approval';
import PermissionPresets from '@deepseek-ai/dsh-permission-presets';
import Storage from '@deepseek-ai/dsh-storage';
import * as StorageJson from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace';
import * as Provider from '@deepseek-ai/dsh-llm-deepseek';
import * as Native from '@deepseek-ai/dsh-experimental-native-run';
import {installBotGuiOwner} from '../src/bot-gui-owner-app.mjs';
import {syntheticResponse,tick} from './work-generation-fixture.mjs';

export const preset='gui-native/empty';
export const initialization=Object.freeze({permissionPreset:'workspace-write',sandboxMode:'workspace-write',approvalPolicy:'ask'});
export async function guiGenerationRuntime(t,{directory,enabled=false,fetcher=()=>syntheticResponse(),initialMode=initialization}={}) {
  directory??=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'gui-native-'));
  const cwd=join(directory,'work');await mkdir(cwd,{recursive:true});
  const ctx=new Context();ctx.baseUrl=new URL(`file://${directory}/native-fixture.json`).href;
  const originalFetch=globalThis.fetch,started=Promise.withResolvers();let requests=0;
  globalThis.fetch=async(...args)=>{requests++;started.resolve();return fetcher(...args);};
  ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'deepseek-official',model:'deepseek-flash',maxTokens:2048,reasoningEffort:'off'})});
  ctx.provide('attachments',{imageLimits:{maxImageBytes:1024,maxImagesPerMessage:1,maxMessageImageBytes:1024,maxImagePixels:1024,maxImageDimension:32,mediaTypes:['image/png']}});
  ctx.provide('fileUploads',{registerAgentResolver:()=>()=>{}});ctx.provide('fs',{});
  ctx.provide('typert',{lookups:{register:()=>()=>{},configure:()=>()=>{}},contexts:{configureHost:()=>()=>{}}});
  ctx.provide('webServer',{register:()=>()=>{}});
  await ctx.plugin(Loader);
  const provider={name:'gui-keyless-synthetic-provider',inject:['llm'],apply(child){Provider.registerDeepSeekProvider(child,'deepseek-official',{
    options:()=>Provider.resolveAdapterOptions({reasoningEffort:'off',maxTokens:2048,retryPolicy:{mode:'normal',maxRetries:0,backoff:{initialDelayMs:1,maxDelayMs:1,jitterRatio:0}}}),resolveAuth:async()=>({headers:{}})});}};
  const plugins={llm:LlmRuntime,sessions:SessionStore,projections:Projections,persistence:Persistence,prompt:SystemPrompt,tools:Tools,
    agents:Agents,loop:AgentLoop,presets:Presets,preset:Preset,query:Query,controller:Controller,provider,protectedProviders:Provider.DeepSeekProtectedProviders,
    storage:Storage,storageJson:StorageJson,storageDomain:StorageDomain,workspace:WorkspaceRegistry};
  Object.assign(ctx.loader.builtins,plugins);
  const rows=Object.keys(plugins).map(id=>({id,name:`cordis:${id}`,config:id==='persistence'?{root:join(directory,'sessions'),compression:'none'}:
    id==='storageJson'?{root:join(directory,'storage')}:id==='storageDomain'?{backend:'json'}:
    id==='loop'?{agents:[]}:id==='presets'?{default:preset}:id==='preset'?{id:preset,plugins:[]}:id==='prompt'?{personaPrefix:'',includeHarnessIdentity:false}:
      id==='controller'?{nativeOpen:false}:{}}));
  await writeFile(join(directory,'native-fixture.json'),JSON.stringify(rows));await ctx.loader.root.update(rows);await ctx.loader.await();
  for(const entry of ctx.loader.entries())await entry.fiber?.await();
  if(initialMode){
    await ctx.plugin(SandboxPolicy,{mode:initialMode.sandboxMode,workspaceRoot:cwd});await ctx.plugin(Approval,{policy:initialMode.approvalPolicy});
    ctx.provide('shell',{sandboxMode:initialMode.sandboxMode});await ctx.plugin(PermissionPresets,{defaultPreset:initialMode.permissionPreset,
      presets:{[initialMode.permissionPreset]:{sandbox:initialMode.sandboxMode,approval:initialMode.approvalPolicy}}});
  }
  await ctx.plugin(child=>{new HostConnectionService(child,[],null);}).await();
  const traced=ctx.get('connection'),connection=traced[symbols.original]??traced;await connection.operator.ctx.fiber.await();
  const handlers=new Map(),register=connection.register;
  connection.register=function(owner,channel,handler){handlers.set(channel,handler);return register.call(this,owner,channel,handler);};
  const app=await installBotGuiOwner({ownerCtx:ctx,homeDirectory:directory,cwd,agentPreset:preset,initialMode:initialMode??undefined,modelRequestsEnabled:enabled});
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;await app.dispose();connection.register=register;await ctx.fiber.dispose();globalThis.fetch=originalFetch;};
  t.after(close);
  const call=(endpoint,payload={})=>handlers.get('/dsh-bot-gui')(endpoint,payload,new AbortController().signal,connection.operator);
  const ownerCall=(endpoint,botId,payload={})=>handlers.get('/dsh-bot-owner')(endpoint,{command:endpoint,botId,payload},new AbortController().signal,connection.operator);
  const waitRequest=async()=>{let timer;try{await Promise.race([started.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('GUI_SYNTHETIC_DISPATCH_TIMEOUT '+JSON.stringify(ctx.sessions.list().map(session=>({sessionId:session.id,events:session.snapshotEvents().slice(-12)}))))),2000);})]);}finally{clearTimeout(timer);}};
  return{Native,ctx,directory,cwd,call,ownerCall,hasOwner:()=>handlers.has('/dsh-bot-owner'),requests:()=>requests,waitRequest,close,tick};
}
