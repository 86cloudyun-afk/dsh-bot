/** Actual stock services; explicitly synthetic blocked LLM/default selection/unused host adapters. */
import {mkdtemp,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';import Loader from '@deepseek-ai/cordis-plugin-loader';
import SessionStore from '@deepseek-ai/dsh-session';import Projections from '@deepseek-ai/dsh-session-projection';import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';import SystemPrompt from '@deepseek-ai/dsh-system-prompt';import Tools from '@deepseek-ai/dsh-tools';import Agents from '@deepseek-ai/dsh-agent';import AgentLoop from '@deepseek-ai/dsh-agent-loop';import Presets from '@deepseek-ai/dsh-agent-preset-registry';import Preset from '@deepseek-ai/dsh-agent-preset';import Query from '@deepseek-ai/dsh-session-query';import Controller from '@deepseek-ai/dsh-api-session-controller';
import {Host} from '../src/host.mjs';import {Ledger} from '../src/ledger.mjs';import {DshAdapter} from '../src/adapter.mjs';import {SessionCreationDriver} from '../src/session-creation.mjs';import {scopeOf} from '@deepseek-ai/dsh-scope';import {digest} from '../src/errors.mjs';
export const preset='offline/empty';
export async function stockRuntime(directory){
 const ctx=new Context();ctx.baseUrl=new URL(`file://${directory}/fixture.json`).href;
 const block=()=>{globalThis.__offlineIO.model++;throw Error('MODEL_REQUEST_FORBIDDEN');};
 ctx.provide('llm',{prepareCall:block,stream:block,listProviders:()=>[],listConfigurableProviders:()=>[]});
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'offline-blocked',model:'never-invoked'})});
 ctx.provide('attachments',{});ctx.provide('fileUploads',{registerAgentResolver:()=>()=>{}});ctx.provide('fs',{});ctx.provide('workspaceRegistry',{archivedSessionIds:[],list:()=>[],get:()=>undefined});
 ctx.provide('typert',{lookups:{register:()=>()=>{},configure:()=>()=>{}},contexts:{configureHost:()=>()=>{}}});
 await ctx.plugin(Loader);
 const plugins={sessions:SessionStore,projections:Projections,persistence:Persistence,prompt:SystemPrompt,tools:Tools,agents:Agents,loop:AgentLoop,presets:Presets,preset:Preset,query:Query,controller:Controller};Object.assign(ctx.loader.builtins,plugins);
 const rows=Object.keys(plugins).map(id=>({id,name:`cordis:${id}`,config:id==='persistence'?{root:join(directory,'sessions'),compression:'none'}:id==='loop'?{agents:[]}:id==='presets'?{default:preset}:id==='preset'?{id:preset,plugins:[]}:id==='prompt'?{personaPrefix:'',includeHarnessIdentity:false}:id==='controller'?{nativeOpen:false}:{}}));
 await writeFile(join(directory,'fixture.json'),JSON.stringify(rows));await ctx.loader.root.update(rows);await ctx.loader.await();for(const entry of ctx.loader.entries())await entry.fiber?.await();
 if(!ctx.get('sessionController'))throw Error('Actual Controller composition failed');return ctx;
}
export function envelope(command,payload,revision=null,epochs={}){return {operationId:randomUUID(),nonce:randomUUID(),command,payloadDigest:digest(payload),expectedRevision:revision,expectedEpochs:epochs,rootHumanInstructionRef:'explicit-offline-owner-work-authorization',authorizationRef:'native-owner',createdAt:new Date().toISOString(),deadline:null};}
export async function stockFixture(t){const directory=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'stock-')),ctx=await stockRuntime(directory),ledger=new Ledger(join(directory,'product.sqlite')),caller=ctx.fiber,host=new Host({ledger,ownerHumanId:'offline-owner',ownerCapability:caller,adapter:new DshAdapter(ctx)});const restores=[];t.after(async()=>{for(const restore of restores)restore();await ctx.fiber.dispose();ledger.close();});
 await host.adapter.refreshSessionModeCatalog();const command=(c,p={},rev=null)=>host.executeOwned(caller,envelope(c,p,rev),p).result;
 const bot=command('createBot',{name:'Fixture Bot',config:{contact:{provider:'offline-blocked',model:'never-invoked'},agentPreset:preset}});
 const intent=command('prepareContactSession',{botId:bot.botId,cwd:directory},bot.revision);
 const creationPort=host.adapter.ownedCreationPort([intent.sessionId],{scopeOf,durable:true});await new SessionCreationDriver({host,caller,port:creationPort}).run(caller,intent.operationId);
 const originAgent=ctx.agents.get(intent.sessionId);return {directory,ctx,ledger,caller,host,bot,originAgent,command,restores,options:{ownerCtx:ctx,host,caller,originAgent,botId:bot.botId,botEpoch:bot.epoch,authorityEpoch:1,cwd:directory,rootInstructionRef:'explicit-offline-owner-work-authorization'}};
}

export async function coldRead(directory,id){const cold=new Context();await cold.plugin(Projections);await cold.plugin(SessionStore);await cold.plugin(Persistence,{root:join(directory,'sessions'),compression:'none'});await cold.plugin(Query);try{if(cold.sessions.get(id)!==undefined || cold.get('agents')!==undefined)throw Error('Cold fixture unexpectedly live');const log=await cold.sessionQuery.readSession(id);if(cold.sessions.get(id)!==undefined)throw Error('Cold query activated Session');return {log,stat:await cold.sessionPersistence.stat(id),coldAgentsAbsent:true};}finally{await cold.fiber.dispose();}}
