/** Actual candidate runtime composition. Only the external provider transport/auth are fake. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
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
import { DeepSeekProtectedProviders, registerDeepSeekProvider, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import { Ledger } from '../src/ledger.mjs';
import { digest } from '../src/errors.mjs';
import { randomUUID } from 'node:crypto';

export function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
export function response(text='Offline reviewed result') {
 return new Response([
  {type:'message_start',message:{id:'offline-only',model:'deepseek-flash',usage:{input_tokens:5,output_tokens:0}}},
  {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:{type:'text_delta',text}},
  {type:'content_block_stop',index:0},
  {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:3}},
  {type:'message_stop'},
 ].map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}
export async function runtime(directory,resolveAuth=async()=>({headers:{}})) {
 const ctx=new Context();ctx.baseUrl=new URL(`file://${directory}/cordis.yml`).href;await ctx.plugin(Loader);
 const provider={name:'offline-external-provider-boundary',inject:['llm','deepseekProtectedProviders'],apply(owner){
  const factory=registerDeepSeekProvider(owner,'deepseek-official',{
   options:()=>resolveAdapterOptions({reasoningEffort:'off',maxTokens:16,retryPolicy:{mode:'normal',maxRetries:0,backoff:{initialDelayMs:1,maxDelayMs:1,jitterRatio:0}}}),resolveAuth,
  });owner.deepseekProtectedProviders.register('deepseek-official',factory);
 }};
 const plugins={llm:LlmRuntime,sessions:SessionStore,projections:Projections,persistence:Persistence,prompt:SystemPrompt,
  tools:Tools,agents:Agents,loop:AgentLoop,presets:Presets,preset:Preset,protectedProviders:DeepSeekProtectedProviders,provider};
 Object.assign(ctx.loader.builtins,plugins);
 const rows=Object.keys(plugins).map(id=>({id,name:`cordis:${id}`,config:id==='persistence'?{root:join(directory,'sessions'),compression:'none'}:
  id==='loop'?{agents:[]}:id==='presets'?{default:'acceptance/empty'}:id==='preset'?{id:'acceptance/empty',plugins:[]}:
  id==='prompt'?{personaPrefix:'',includeHarnessIdentity:false}:{}}));
 await writeFile(join(directory,'cordis.yml'),JSON.stringify(rows)+'\n');await ctx.loader.root.update(rows);await ctx.loader.await();
 for(const entry of ctx.loader.entries())await entry.fiber?.await();return ctx;
}
export async function fixture(Controller,resolveAuth,{beforeCreate,capacity,maxTokens,acceptanceGuard,workingSetEnabled=false}={}) {
 const directory=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'native-case-'));
 const ctx=await runtime(directory,resolveAuth),ledger=new Ledger(join(directory,'product.sqlite'));
 const open=()=>new Controller({ctx,ledger,ownerLabel:'offline-runtime-owner',directory:join(directory,'journal'),acceptanceGuard,workingSetEnabled,
  capacity:capacity ?? {executionSlots:1,contactSlots:1,executionTokens:512,contactTokens:512,tokenReservationPerStep:128,maxSteps:1,admissionDeadlineMs:1000,settlementDeadlineMs:100}});
 const state={controller:open()},caller=ctx.fiber;
 const command=(name,payload={},expectedRevision=null,deadline=null,operationId=randomUUID())=>{
  const e={operationId,nonce:randomUUID(),command:name,payloadDigest:digest(payload),expectedRevision,
   expectedEpochs:{},rootHumanInstructionRef:'explicit-offline-owner-test',authorizationRef:'native-owner',createdAt:new Date().toISOString(),deadline};
  return state.controller.command(caller,e,payload);
 };
 await state.controller.refreshModes(caller);
 const bot=command('createBot',{name:'offline-review',config:{contact:{provider:'deepseek-official',model:'deepseek-flash',reasoning:'off'},agentPreset:'acceptance/empty'}}).result;
 const task=command('createTask',{ownerBotId:bot.botId,title:'Offline authored review',scope:{namespace:'private-review',writeResources:[]},acceptance:'Check returned source evidence'}).result;
 const contact=command('prepareContactSession',{botId:bot.botId,cwd:directory},ledger.get('bot',bot.botId).revision).result;
 const execution=command('prepareExecutionSession',{botId:bot.botId,taskId:task.taskId,cwd:directory},ledger.get('bot',bot.botId).revision).result;
 const ids={contactCreationId:contact.operationId,executionCreationId:execution.operationId};
 await state.controller.open(caller,{...ids,create:true,maxTokens:maxTokens ?? {contact:16,execution:16}});
 await beforeCreate?.(ctx);
 await state.controller.createSession(caller,contact.operationId);await state.controller.createSession(caller,execution.operationId);
 const prepare=(kind='execution',text='Review the supplied harmless design.')=>command('prepareNativeTextOperation',{kind,steps:[text]}).result;
 const stop=operationId=>command('stopNativeTextOperation',{operationId});
 return Object.assign(state,{directory,ctx,ledger,caller,bot,task,contact,execution,ids,command,prepare,stop,open,
  async close(){await state.controller.close(caller);await ctx.fiber.dispose();ledger.close();}});
}
