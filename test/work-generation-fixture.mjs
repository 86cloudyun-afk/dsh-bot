/** Actual SDK loop substrate with keyless synthetic SSE transport. No remote model evidence. */
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
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
import * as Provider from '@deepseek-ai/dsh-llm-deepseek';
import {Ledger} from '../src/ledger.mjs';
import {Host} from '../src/host.mjs';
import {DshAdapter} from '../src/adapter.mjs';
import {digest} from '../src/errors.mjs';

export const preset='synthetic/empty';
export const route=Object.freeze({provider:'deepseek-official',model:'deepseek-flash',maxTokens:16,reasoningEffort:'off'});
export function syntheticResponse({finish=true,usage=true,text='Synthetic work result'}={}) {
 const events=[{type:'message_start',message:{id:'synthetic-response',model:route.model,...usage?{usage:{input_tokens:5,output_tokens:0}}:{}}},
  {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:{type:'text_delta',text}},
  {type:'content_block_stop',index:0},
  {type:'message_delta',delta:finish?{stop_reason:'end_turn'}:{},...usage?{usage:{output_tokens:3}}:{}},
  {type:'message_stop'}];
 return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}
export const envelope=(command,payload,revision=null,epochs={})=>({operationId:crypto.randomUUID(),nonce:crypto.randomUUID(),command,payloadDigest:digest(payload),expectedRevision:revision,expectedEpochs:epochs,authorizationRef:'native-owner',rootHumanInstructionRef:'explicit-synthetic-native-loop',createdAt:new Date().toISOString(),deadline:null});
export const tick=()=>new Promise(resolve=>setImmediate(resolve));

export async function generationFixture(t,fetcher=()=>syntheticResponse()) {
 const Native=await import('@deepseek-ai/dsh-experimental-native-run');
 if(typeof Native.prepareOwnedGenerationSource!=='function'||typeof Native.isPreparedOwnedGenerationSource!=='function')throw Error('FUTURE_NATIVE_GENERATION_SDK_REQUIRED');
 if(typeof Provider.DeepSeekProtectedProviders!=='function')throw Error('FUTURE_PROTECTED_PROVIDER_SDK_REQUIRED');
 const directory=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'generation-')),ctx=new Context();ctx.baseUrl=new URL(`file://${directory}/fixture.json`).href;
 const originalFetch=globalThis.fetch;let requests=0;globalThis.fetch=async(...args)=>{requests++;return fetcher(...args);};
 const ledger=new Ledger(join(directory,'product.sqlite'));t.after(async()=>{globalThis.fetch=originalFetch;await ctx.fiber.dispose();ledger.close();});
 ctx.provide('agentDefaultModel',{currentSelection:()=>route});ctx.provide('attachments',{});ctx.provide('fileUploads',{registerAgentResolver:()=>()=>{}});ctx.provide('fs',{});ctx.provide('workspaceRegistry',{archivedSessionIds:[],list:()=>[],get:()=>undefined});ctx.provide('typert',{lookups:{register:()=>()=>{},configure:()=>()=>{}},contexts:{configureHost:()=>()=>{}}});
 await ctx.plugin(Loader);
 const provider={name:'keyless-synthetic-provider-owner',inject:['llm'],apply(child){Provider.registerDeepSeekProvider(child,'deepseek-official',{options:()=>Provider.resolveAdapterOptions({reasoningEffort:'off',maxTokens:16,retryPolicy:{mode:'normal',maxRetries:1,backoff:{initialDelayMs:1,maxDelayMs:1,jitterRatio:0}}}),resolveAuth:async()=>({headers:{}})});}};
 const plugins={llm:LlmRuntime,sessions:SessionStore,projections:Projections,persistence:Persistence,prompt:SystemPrompt,tools:Tools,agents:Agents,loop:AgentLoop,presets:Presets,preset:Preset,query:Query,protectedProviders:Provider.DeepSeekProtectedProviders,provider};Object.assign(ctx.loader.builtins,plugins);
 const rows=Object.keys(plugins).map(id=>({id,name:`cordis:${id}`,config:id==='persistence'?{root:join(directory,'sessions'),compression:'none'}:id==='loop'?{agents:[]}:id==='presets'?{default:preset}:id==='preset'?{id:preset,plugins:[]}:id==='prompt'?{personaPrefix:'',includeHarnessIdentity:false}:{}}));
 await writeFile(join(directory,'fixture.json'),JSON.stringify(rows));await ctx.loader.root.update(rows);await ctx.loader.await();for(const entry of ctx.loader.entries())await entry.fiber?.await();
 const caller=ctx.fiber,host=new Host({ledger,ownerHumanId:'synthetic-sdk-loop-owner',ownerCapability:caller,adapter:new DshAdapter(ctx)});await host.adapter.refreshSessionModeCatalog();
 const command=(name,payload,revision=null,epochs={})=>host.executeOwned(caller,envelope(name,payload,revision,epochs),payload).result;
 const bot=command('createBot',{name:'Synthetic Generation Bot',config:{contact:{provider:route.provider,model:route.model},agentPreset:preset}});
 const prepareGeneration=(intent,role='work')=>({prepared:Native.prepareOwnedGenerationSource({ownerCtx:ctx,providerFactory:ctx.deepseekProtectedProviders.lookup(route.provider),sessionId:intent.sessionId,role,route,isCurrent:()=>true}),route});
 return {Native,ctx,ledger,host,caller,bot,directory,command,prepareGeneration,requests:()=>requests};
}
