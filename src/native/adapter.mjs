import {installModelSelection} from '@deepseek-ai/dsh-agent';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {realpath, stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {copy, plain, requireCondition} from './store.mjs';

/** Thin public-service adapter. No host copies, private drivers or global defaults. */
export class NativeDshAdapter {
  #ctx; #store; #policy; #handles = new Map(); #creating = new Map(); #closed = false; #contextProvider;
  constructor(ctx,{store,policy}={}) {this.#ctx=ctx;this.#store=store;this.#policy=policy;}
  get context() {return this.#ctx;}
  setContextProvider(provider) {this.#contextProvider=provider;}
  async models() {
    const providers=this.#ctx.llm.listProviders();
    return {providers:await Promise.all(providers.map(async provider=>({...copy(provider),models:await this.#ctx.llm.listModels(provider.id)})))};
  }
  async validateModel(input) {
    requireCondition(plain(input) && typeof input.provider==='string' && typeof input.model==='string' && Object.keys(input).every(key=>['provider','model','reasoningEffort','maxTokens','temperature'].includes(key)),'invalid_model');
    const catalog=await this.#ctx.llm.listModels(input.provider);
    requireCondition(catalog.some(model=>model.id===input.model),'model_unavailable');
    const resolved=await this.#ctx.llm.resolveCallConfig(copy(input));return copy(resolved);
  }
  async validateLocation(cwd) {
    requireCondition(typeof cwd==='string' && isAbsolute(cwd),'invalid_cwd');
    const path=await realpath(cwd);requireCondition((await stat(path)).isDirectory(),'invalid_cwd');return path;
  }
  async createOwned(binding,setup) {
    requireCondition(!this.#closed,'disposed');
    if(this.#handles.has(binding.sessionId))return this.#handles.get(binding.sessionId);
    if(this.#creating.has(binding.sessionId))return this.#creating.get(binding.sessionId);
    const operation=(async()=>{
      const model=copy(binding.model),presets=this.#ctx.get('agentPresets');
      const handle=await this.#ctx.agents.create({sessionId:binding.sessionId,meta:{cwd:binding.cwd,...(binding.presetId?{agentPreset:binding.presetId}:{})},
        agentOptions:{provider:model.provider,model:model.model,...(model.maxTokens===undefined?{}:{maxTokens:model.maxTokens})},
        setup:async(agentCtx,agent)=>{
          if(presets)await agentCtx.agentPresets.mount(agentCtx,binding.presetId??undefined);
          installModelSelection(agentCtx,{current:Object.freeze({...model})});
          let previousContext;
          agentCtx.on('agent/pre-step',async(_payload,next)=>{
            const current=this.#store?.read().sessions[binding.sessionId];
            requireCondition(!this.#closed && (!current||current.state==='ready'),'session_not_ready');
            const decision=await next();if(decision.kind==='reject'||!this.#contextProvider)return decision;
            const context=await this.#contextProvider(agent,current??binding);
            if(context===previousContext)return decision;
            previousContext=context;
            const message=createUserMessage({content:[{type:'text',text:context}],source:{kind:'dsh-bot-context',botId:binding.botId}});
            return {...decision,messages:[...decision.messages,message]};
          });
          await setup?.(agentCtx,agent);
        }});
      try {requireCondition(!this.#closed,'disposed');await this.#ctx.sessions.flush(handle.agent.session);this.#handles.set(binding.sessionId,handle);return handle;}
      catch(error){await handle.dispose();throw error;}
    })();
    this.#creating.set(binding.sessionId,operation);
    try{return await operation;}finally{this.#creating.delete(binding.sessionId);}
  }
  async readNative(sessionId,signal) {
    const handle=await this.#ctx.sessionPersistence.open(sessionId,'read');
    try {const {events}=await handle.read(0,undefined,{signal});return {header:copy(handle.header),events:copy(events),original:true};}
    finally {await handle.close();}
  }
  async listNative(_request={},signal) {
    signal?.throwIfAborted();
    const rows=await this.#ctx.sessionPersistence.list(),list=new Map(rows.map(row=>[row.header.id,{sessionId:row.header.id,header:copy(row.header)}]));
    for(const session of this.#ctx.sessions.list())if(!list.has(session.id))list.set(session.id,{sessionId:session.id,header:copy(session.header)});
    return [...list.values()];
  }
  async disposeOwned(sessionId) {const handle=this.#handles.get(sessionId);if(!handle)return;await handle.dispose();this.#handles.delete(sessionId);}
  async close() {this.#closed=true;await Promise.allSettled([...this.#creating.values()]);await Promise.all([...this.#handles.keys()].map(id=>this.disposeOwned(id)));}
}
