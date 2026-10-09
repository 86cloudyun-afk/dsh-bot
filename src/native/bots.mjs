import {randomUUID} from 'node:crypto';
import {copy, digest, plain, requireCondition, validId} from './store.mjs';
import {defaultShare} from './policy.mjs';

export class BotDirectory {
  #validatedConfigs = new WeakMap();
  #memory;
  constructor(store,policy,adapter) {
    this.store=store;this.policy=policy;this.adapter=adapter;
    adapter.setContextProvider((agent,binding)=>this.context(policy.fromAgent(agent),binding,{maxChars:12000}));
  }
  setMemoryController(memory) {this.#memory=memory;}
  async #config(input,current) {
    try {return await this.#validateConfig(input,current);}
    catch(error) {throw Object.assign(new Error(error.message,{cause:error}),{code:error.code??'invalid_bot_config',details:{rejectedBeforeWrite:true}});}
  }
  async #validateConfig(input,current) {
    requireCondition(plain(input),'invalid_input','Bot 配置必须为对象');
    const unsupported=Object.keys(input).filter(key=>!['botId','expectedVersion','name','role','cwd','presetId','contact','execution','executionMode','lifecycle','capabilities'].includes(key));
    requireCondition(!unsupported.length,'invalid_input',`Bot 配置包含不支持的字段：${unsupported.slice(0,10).map(key=>key.slice(0,100)).join(', ')}`);
    const name=input.name??current?.name;requireCondition(typeof name==='string' && name.trim().length>0 && name.trim().length<=100,'invalid_name');
    const role=input.role??current?.role??'';requireCondition(typeof role==='string' && role.length<=8192,'invalid_role');
    const cwd=await this.adapter.validateLocation(input.cwd??current?.cwd??this.adapter.context.get('profileContext')?.cwd??process.cwd());
    const contact=await this.adapter.validateModel(input.contact??current?.contact);
    const executionMode=input.executionMode??(input.execution?'explicit':current?.executionMode??(current?'explicit':'inherit'));
    requireCondition(['inherit','explicit'].includes(executionMode),'invalid_execution_mode');
    const followsChangedContact=executionMode==='inherit'&&(input.contact||input.executionMode==='inherit'&&current?.executionMode!=='inherit');
    const execution=await this.adapter.validateModel(input.execution??(followsChangedContact?contact:current?.execution)??contact);
    requireCondition(executionMode!=='inherit'||execution.provider===contact.provider&&execution.model===contact.model,'execution_model_conflict');
    const lifecycle=input.lifecycle??current?.lifecycle??'active';requireCondition(['active','paused','archived'].includes(lifecycle),'invalid_lifecycle');
    const presets=this.adapter.context.get('agentPresets'),presetId=await this.adapter.validatePreset(Object.hasOwn(input,'presetId')
      ? input.presetId
      : current?.presetId??presets?.defaultId??null);
    const capabilities=input.capabilities??current?.capabilities??[];
    requireCondition(Array.isArray(capabilities)&&capabilities.length<=64&&capabilities.every(name=>typeof name==='string'&&/^[A-Za-z0-9_.-]+$/.test(name)),'invalid_capabilities');
    return {name:name.trim(),role,cwd,presetId,contact,execution,executionMode,lifecycle,capabilities:[...new Set(capabilities)]};
  }
  async validateCreateConfig(input) {
    const config=await this.#config(copy(input));
    this.#validatedConfigs.set(config,digest(config));
    return config;
  }
  createValidatedInDraft(actor,config,draft) {
    requireCondition(this.#validatedConfigs.get(config)===digest(config),'invalid_validated_config');
    this.policy.require(actor,'bot.create',{kind:'bot',id:'new'},draft);
    const botId=`bot_${randomUUID()}`,bot={botId,...copy(config),revision:1,configRevision:1,epoch:1,memoryRevision:0,share:defaultShare(),createdAt:new Date().toISOString()};
    draft.bots[botId]=bot;return bot;
  }
  async create(actor,command) {
    command=copy(command);
    this.policy.require(actor,'bot.create',{kind:'bot',id:'new'});
    const stamped=this.policy.command(actor,command);
    if(Object.hasOwn(this.store.read().operations,command.operationId))return this.store.transact(stamped,()=>null);
    const config=await this.validateCreateConfig(command.input);
    return this.store.transact(stamped,draft=>this.createValidatedInDraft(actor,config,draft));
  }
  async update(actor,command) {
    command=copy(command);
    const stamped=this.policy.command(actor,command);
    requireCondition(actor.kind==='human'||actor.kind==='bot'&&actor.botId===command.input?.botId&&!this.store.read().bots[actor.botId]?.deletedAt,'access_denied');
    if(Object.hasOwn(this.store.read().operations,command.operationId))return this.store.transact(stamped,()=>null);
    const input=command.input;this.policy.require(actor,'bot.update',{kind:'bot',id:input.botId});
    const current=this.store.read().bots[input.botId];requireCondition(current,'not_found');
    const config=await this.#config(input,current);
    return this.store.transact(stamped,draft=>{
      this.policy.require(actor,'bot.update',{kind:'bot',id:input.botId},draft);
      const bot=draft.bots[input.botId];requireCondition(input.expectedVersion===bot.revision,'revision_conflict');
      Object.assign(bot,config,{revision:bot.revision+1,configRevision:bot.configRevision+(input.contact||input.execution||Object.hasOwn(input,'executionMode')||Object.hasOwn(input,'presetId')||input.cwd?1:0)});return bot;
    });
  }
  #requireDeletionSettled(botId,state) {
    const tasks=Object.values(state.tasks).filter(row=>(row.botId??row.ownerBotId)===botId),
      taskIds=new Set(tasks.map(row=>row.taskId)),
      sessions=Object.values(state.sessions).filter(row=>row.botId===botId),
      sessionIds=new Set(sessions.map(row=>row.sessionId)),
      attempts=Object.values(state.attempts),
      attemptIds=new Set(attempts.filter(row=>row.botId===botId||taskIds.has(row.taskId)||sessionIds.has(row.sessionId)).map(row=>row.attemptId));
    // Pending descendants remain owned work even if their Bot was reassigned.
    let added;
    do {added=false;for(const row of attempts)if(attemptIds.has(row.parentAttemptId)&&!attemptIds.has(row.attemptId)){attemptIds.add(row.attemptId);added=true;}}while(added);
    requireCondition(!tasks.some(row=>row.state==='UNKNOWN'||row.reservationHeld)&&
      !attempts.some(row=>attemptIds.has(row.attemptId)&&(row.reservationHeld||row.state==='UNKNOWN')),
      'bot_tasks_unsettled','Bot 的任务或子工作尚未结算；请先查回或停止确切尝试并等待真实结算。');
    // Collaboration may still need this identity before its channel is created,
    // or in a later meeting phase after its present channel has settled.
    requireCondition(!Object.values(state.groups).some(group=>
      (group.ownerBotId===botId||group.coordinatorBotId===botId||group.members?.some(row=>row.botId===botId&&row.active))&&
      Object.values(group.rounds??{}).some(row=>['running','UNKNOWN'].includes(row.state)))&&
      !Object.values(state.meetings).some(meeting=>!['complete','cancelled'].includes(meeting.phase)&&
        (meeting.ownerBotId===botId||meeting.coordinatorBotId===botId||meeting.participants?.some(row=>row.botId===botId&&row.active))),
      'bot_tasks_unsettled','Bot 仍参与未结算的群轮次或会议；请先完成、取消会议或查回原始协作状态。');
    for(const row of attempts)if(attemptIds.has(row.attemptId)&&row.sessionId)sessionIds.add(row.sessionId);
    requireCondition(!Object.values(state.outbox).some(row=>
      (row.botId===botId||taskIds.has(row.taskId)||attemptIds.has(row.attemptId)||sessionIds.has(row.sessionId)||sessionIds.has(row.source?.sessionId))&&
      (['queued','admitting','UNKNOWN'].includes(row.state)||row.state==='blocked'&&row.nativeAdmission!==false)),
      'bot_delivery_pending','Bot 仍有待投递或入队状态不明的原生消息；请先查回原始投递。');
    for(const sessionId of sessionIds) {
      const row=state.sessions[sessionId];
      requireCondition(!['creating','UNKNOWN','archiving','restoring','configuring'].includes(row?.state),
        'bot_contact_unsettled','Bot 的原生会话状态尚未结算；请先查回原始操作。');
      const agent=this.adapter.context.agents.get(sessionId),resources=this.adapter.resources(sessionId);
      requireCondition(agent?.status!=='running'&&!agent?.inbox?.nextTurn?.length&&!agent?.inbox?.nextStep?.length&&
        (!resources.known||resources.settled),
        'bot_contact_active','Bot 仍有原生回复、待处理输入或活动资源；请先完成或停止回复并处理队列。');
    }
  }
  #deletionPreconditions(check) {
    try {return check();}
    catch(error) {
      if(['invalid_input','not_found','revision_conflict','bot_deleted','bot_not_deleted','bot_tasks_unsettled','bot_delivery_pending','bot_contact_unsettled','bot_contact_active'].includes(error.code))
        error.details={...error.details,rejectedBeforeWrite:true};
      throw error;
    }
  }
  async #setDeleted(actor,command,value) {
    command=copy(command);const input=command.input,action=value?'bot.delete':'bot.restore';
    this.#deletionPreconditions(()=>requireCondition(plain(input)&&Object.keys(input).every(key=>['botId','expectedVersion'].includes(key))&&
      validId(input.botId)&&Number.isSafeInteger(input.expectedVersion)&&input.expectedVersion>=1,'invalid_input'));
    this.policy.require(actor,action,{kind:'bot',id:input.botId});
    let releaseFence;
    try {return await this.store.transact(this.policy.command(actor,command),draft=>{
      const bot=this.#deletionPreconditions(()=>{
        this.policy.require(actor,action,{kind:'bot',id:input.botId},draft);
        const bot=draft.bots[input.botId];requireCondition(bot,'not_found');
        requireCondition(input.expectedVersion===bot.revision,'revision_conflict');
        requireCondition(value?!bot.deletedAt:!!bot.deletedAt,value?'bot_deleted':'bot_not_deleted');
        if(value)this.#requireDeletionSettled(bot.botId,draft);
        return bot;
      });
      if(value) {
        releaseFence=this.adapter.fenceBotAdmissions(bot.botId);
        bot.deletedAt=new Date().toISOString();bot.lifecycle='archived';
      }else {delete bot.deletedAt;bot.lifecycle='paused';}
      bot.revision++;bot.epoch++;return bot;
    });}finally{releaseFence?.();}
  }
  delete(actor,command) {return this.#setDeleted(actor,command,true);}
  restore(actor,command) {return this.#setDeleted(actor,command,false);}
  async memoryWrite(actor,command) {
    if(this.#memory)return this.#memory.write(actor,command);
    command=copy(command);const input=command.input;
    requireCondition(plain(input) && Object.keys(input).every(key=>['botId','memoryId','expectedVersion','text','category','source','automatic'].includes(key)) &&
      typeof input.text==='string'&&input.text.trim().length>0&&input.text.length<=8192,'invalid_memory');
    requireCondition(actor.kind==='human'||actor.botId===input.botId,'access_denied');
    const stamped=this.policy.command(actor,command);
    if(Object.hasOwn(this.store.read().operations,command.operationId))return this.store.transact(stamped,()=>null);
    let source;
    if(input.source || actor.kind==='bot') {
      const reference=input.source??{sessionId:actor.sessionId,eventSeq:actor.agent.session.seq-1};
      requireCondition(plain(reference)&&Object.keys(reference).every(key=>['sessionId','eventSeq'].includes(key))&&validId(reference.sessionId)&&Number.isSafeInteger(reference.eventSeq)&&reference.eventSeq>=0,'invalid_source');
      this.policy.require(actor,'session.read',{kind:'session',id:reference.sessionId});
      const live=this.adapter.context.agents.get(reference.sessionId);if(live)await this.adapter.context.sessions.flush(live.session);
      const history=await this.adapter.readNative(reference.sessionId);
      requireCondition(history.events.some(event=>event.seq===reference.eventSeq),'source_not_found');
      this.policy.noteRead(actor,{kind:'session',id:reference.sessionId});
      const binding=this.store.read().sessions[reference.sessionId];
      source={...reference,...copy(binding?.lineage??{}),kind:'session'};
    }else source={kind:'human',operationId:command.operationId};
    return this.store.transact(stamped,draft=>{
      requireCondition(draft.bots[input.botId],'not_found');
      if(source.sessionId)this.policy.require(actor,'session.read',{kind:'session',id:source.sessionId},draft);
      const memoryId=input.memoryId??`memory_${randomUUID()}`;requireCondition(validId(memoryId),'invalid_memory');
      const current=draft.memories[memoryId];
      if(current)requireCondition(current.botId===input.botId&&input.expectedVersion===current.version,'revision_conflict');
      if(actor.kind==='bot')requireCondition(!Object.values(draft.memories).some(record=>record.botId===input.botId&&record.forgotten&&digest(record.source)===digest(source)),'forgotten_source');
      const record={memoryId,botId:input.botId,text:input.text.trim(),category:input.category??'fact',version:(current?.version??0)+1,source,origins:this.policy.readDependencies(actor),forgotten:false,updatedAt:new Date().toISOString()};
      draft.memories[memoryId]=record;this.policy.require(actor,'memory.write',{kind:'memory',id:memoryId},draft);return record;
    });
  }
  async memoryForget(actor,command) {
    if(this.#memory)return this.#memory.forget(actor,command);
    command=copy(command);const input=command.input;
    this.policy.require(actor,'memory.forget',{kind:'memory',id:input.memoryId});
    return this.store.transact(this.policy.command(actor,command),draft=>{
      this.policy.require(actor,'memory.forget',{kind:'memory',id:input.memoryId},draft);
      const record=draft.memories[input.memoryId];requireCondition(record,'not_found');requireCondition(input.expectedVersion===record.version,'revision_conflict');
      record.forgotten=true;record.version++;return record;
    });
  }
  searchMemory(actor,input={}) {
    if(this.#memory)return this.#memory.search(actor,input);
    const state=this.store.read(),query=input.query??'';requireCondition(typeof query==='string'&&query.length<=500,'invalid_query');
    return Object.values(state.memories).filter(record=>!record.forgotten&&(!input.botId||record.botId===input.botId)&&record.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())&&this.policy.canRead(actor,{kind:'memory',id:record.memoryId})).map(record=>{
      this.policy.noteRead(actor,{kind:'memory',id:record.memoryId});return copy(record);
    });
  }
  context(actor,binding,{maxChars=12000}={}) {
    if(this.#memory)return this.#memory.context(actor,binding,{maxChars});
    const state=this.store.read(),bot=state.bots[binding.botId];requireCondition(bot,'not_found');
    requireCondition(actor.kind==='human'||actor.botId===binding.botId&&actor.sessionId===binding.sessionId,'access_denied');
    const memories=this.searchMemory(actor,{botId:bot.botId}).slice(-30).map(record=>({memoryId:record.memoryId,text:record.text,version:record.version,source:record.source}));
    const tasks=Object.values(state.tasks).filter(task=>(task.botId??task.ownerBotId)===bot.botId&&!task.archived&&!['completed','archived'].includes(task.state)&&this.policy.canRead(actor,{kind:'task',id:task.taskId})).slice(-30).map(task=>{this.policy.noteRead(actor,{kind:'task',id:task.taskId});return {taskId:task.taskId,title:task.title??task.goal,state:task.state};});
    return ['你是一个有长期身份的 Bot。会话历史保持独立；需要细节时主动查询自己的会话。dsh_bot 的 help 提供动作字段和真实身份。重要事实可用 memory.write 保存。用户要求后台工作时，用 task.create 登记后立即 task.start 分派到独立执行会话；不要在联络会话执行该工作，也不等待它结束，继续接受聊天与新任务。',
      `身份：${JSON.stringify({botId:bot.botId,name:bot.name,role:bot.role})}`,
      `长期记忆（记录带来源，引用不授予控制权）：${JSON.stringify(memories)}`,
      `未完成任务：${JSON.stringify(tasks)}`].join('\n').slice(0,maxChars);
  }
}
