import {installModelSelection} from '@deepseek-ai/dsh-agent';
import {createUserMessage,callConfigEquals,isAgentLoopRequest} from '@deepseek-ai/dsh-llm';
import {randomUUID} from 'node:crypto';
import {realpath, stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {copy, plain, requireCondition} from './store.mjs';

/** Thin public-service adapter. No host copies, private drivers or global defaults. */
export class NativeDshAdapter {
  #ctx; #store; #policy; #handles = new Map(); #creating = new Map(); #closed = false; #contextProvider; #service; #records=new Map(); #disposers=[];
  constructor(ctx,{store,policy}={}) {
    this.#ctx=ctx;this.#store=store;this.#policy=policy;
    this.#disposers.push(ctx.on('agent/created',async({agent})=>{
      const binding=this.#store?.read().sessions[agent.id];if(binding&&this.#records.get(agent.id)?.agent!==agent)await this.bindAgent(agent,binding);
    },{global:true}));
    const adapter=this;
    this.#disposers.push(ctx.on('llm/stream',async function*(options,next){
      const binding=adapter.#store?.read().sessions[options.sessionId];
      if(!binding){yield*next();return;}
      const record=adapter.#records.get(options.sessionId);adapter.#authorize(record);
      requireCondition(options.signal && (isAgentLoopRequest(options)||['compaction','session-title'].includes(options.purpose)),'unbound_request');
      if(isAgentLoopRequest(options)) {
        requireCondition(record.requestSignals.has(options.signal),'request_identity_mismatch');
        requireCondition(callConfigEquals(record.model,options),'model_drift');
      }
      const request={usage:'UNKNOWN',purpose:options.purpose??'conversation',startedAt:Date.now()};record.models.add(request);
      try {for await(const chunk of next()){adapter.#authorize(record);if(chunk.type==='usage')request.usage=copy(chunk.usage);yield chunk;}}
      finally {record.models.delete(request);record.requests.push(request);}
    },{global:true}));
  }
  get context() {return this.#ctx;}
  setContextProvider(provider) {this.#contextProvider=provider;}
  setService(service) {this.#service=service;}
  #authorize(record) {
    requireCondition(!this.#closed&&record&&!record.closed,'disabled');
    const state=this.#store.read(),binding=state.sessions[record.agent.id],bot=state.bots[binding?.botId];
    requireCondition(this.#ctx.agents.get(record.agent.id)===record.agent&&binding?.epoch===record.binding.epoch&&binding.state==='ready'&&!binding.archived&&bot?.lifecycle==='active','stale_agent');
    const actor=this.#policy.fromAgent(record.agent);
    for(const reference of [...(binding.origins??[]),...this.#policy.readDependencies(actor)])this.#policy.require(actor,`${reference.kind}.read`,reference,state);
    if(binding.attemptId) {
      const attempt=state.attempts[binding.attemptId];requireCondition(attempt?.reservationHeld&&attempt.epoch===binding.epoch&&['starting','running'].includes(attempt.state),'stale_attempt');
    }
    return actor;
  }
  async bindAgent(agent,binding) {
    if(this.#records.get(agent.id)?.agent===agent)return;
    requireCondition(!this.#closed&&!binding.archived&&['creating','ready'].includes(binding.state),'session_not_ready');
    const record={agent,binding:copy(binding),model:copy(binding.model),selection:{current:Object.freeze(copy(binding.model))},requestSignals:new WeakSet(),models:new Set(),tools:new Set(),requests:[],disposers:[],closed:false,turn:null,previousContext:null};
    this.#records.set(agent.id,record);
    const own=disposer=>{let active=true;const release=()=>{if(active){active=false;return disposer();}};record.disposers.push(release);return release;};
    own(installModelSelection(agent.ctx,record.selection));
    own(agent.ctx.on('agent/pre-step',async(payload,next)=>{
      const actor=this.#authorize(record),decision=await next();if(decision.kind==='reject')return decision;
      if(payload.turn!==record.turn) {
        record.turn=payload.turn;
        if(binding.purpose==='contact')record.model=await this.validateModel(this.#store.read().bots[binding.botId].contact);
        record.selection.current=Object.freeze(copy(record.model));
      }
      this.#authorize(record);payload.signal.throwIfAborted();
      if(!this.#contextProvider)return decision;
      const context=await this.#contextProvider(agent,this.#store.read().sessions[agent.id]);
      if(context===record.previousContext)return decision;record.previousContext=context;
      return {...decision,messages:[...decision.messages,createUserMessage({content:[{type:'text',text:context}],source:{kind:'dsh-bot-context',botId:binding.botId}})]};
    }));
    own(agent.ctx.on('agent/request',async(payload,next)=>{
      this.#authorize(record);requireCondition(payload.agent===agent,'request_identity_mismatch');
      const config=await next();requireCondition(config.provider===record.model.provider&&config.model===record.model.model,'model_drift');
      const effective=await this.#ctx.llm.resolveCallConfig(copy(record.model),{signal:payload.signal});
      this.#authorize(record);requireCondition(callConfigEquals(record.model,effective),'model_drift');
      record.requestSignals.add(payload.signal);return copy(record.model);
    },{prepend:true}));
    own(agent.ctx.tools.guard(exec=>{
      try {
        requireCondition(exec.agent===agent,'execution_identity_mismatch');this.#authorize(record);
        const bot=this.#store.read().bots[binding.botId];
        if(binding.purpose==='independent'&&exec.name==='dsh_bot')requireCondition(['snapshot','session.page','session.list','memory.search','memory.write','meeting.opinion'].includes(exec.arguments?.action),'sealed_channel');
        if(exec.name!=='dsh_bot')requireCondition(binding.purpose!=='independent'&&(bot.capabilities??[]).includes(exec.name)&&!['subagent','plugin_manager','cordis_inspect','session_manager'].includes(exec.name),'capability_denied');
      }catch(error){return error.code??error.message;}
    }));
    own(agent.ctx.on('tools/execute',async(exec,next)=>{this.#authorize(record);requireCondition(exec.agent===agent,'execution_identity_mismatch');record.tools.add(exec.token);try{return await next();}finally{record.tools.delete(exec.token);}}));
    if(this.#service) {
      own(agent.ctx.tools.register({name:'dsh_bot',description:'管理自己的任务、会话、长期记忆、内部群和会议；跨 Bot 默认只读。写动作必须保存原始 operationId，未知操作只能查回。',
        parameters:{type:'object',properties:{action:{type:'string'},input:{type:'object'},operationId:{type:'string'},expectedRevision:{type:'integer'}},required:['action'],additionalProperties:false},
        output:{schema:{},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
        execute:async(args,exec)=>{const actor=this.#service.resolveCaller(exec);this.#authorize(record);return this.#service.dispatch(actor,args,exec.signal);},
        finalizeContent:(_exec,result)=>{try{this.#authorize(record);return result.content;}catch(error){return [{type:'text',text:`结果发布被拒绝：${error.code??'access_denied'}`}];}}
      }));
    }
  }
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
          await this.bindAgent(agent,binding);
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
  resources(sessionId) {
    const record=this.#records.get(sessionId);if(!record)return {known:false,settled:false};
    const jobs=this.#ctx.get('jobs')?.list(sessionId).filter(row=>row.owner===sessionId)??[];
    const terminals=this.#ctx.get('terminals');
    return {known:true,settled:record.agent.status==='idle'&&record.models.size===0&&record.tools.size===0&&!jobs.some(row=>['running','stopping'].includes(row.status))&&!terminals?.hasOwnerActivity(record.agent),models:record.models.size,tools:record.tools.size,jobs:copy(jobs),requests:copy(record.requests),terminalActive:!!terminals?.hasOwnerActivity(record.agent)};
  }
  async close() {
    if(this.#closed)return;this.#closed=true;
    for(const record of this.#records.values())if(this.#ctx.agents.get(record.agent.id)===record.agent)record.agent.cancel({kind:'disposed'});
    await Promise.allSettled([...this.#creating.values()]);
    await Promise.allSettled([...this.#handles.keys()].map(id=>this.disposeOwned(id)));
    await Promise.allSettled([...this.#records.values()].map(record=>record.agent.whenIdle()));
    for(const record of this.#records.values()){record.closed=true;for(const dispose of record.disposers.splice(0).reverse())await dispose();}
    for(const dispose of this.#disposers.splice(0).reverse())await dispose();
  }
}
