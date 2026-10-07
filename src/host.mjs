import { randomUUID } from 'node:crypto';
import { canonical, text, requireValue, CommandError } from './errors.mjs';
import { DshAdapter, REQUIRED_NATIVE } from './adapter.mjs';
import { registerCollaboration } from './collaboration.mjs';
import { autonomyPolicy,registerProgression } from './progression.mjs';
import { emptyPresetCatalog,requireHealthyPreset,prepareSessionCreate } from './session-mode.mjs';
import { projectBotTaskSnapshot } from './bot-task-read-model.mjs';
import {createWorkSessionManager} from './work-sessions.mjs';
import {createOwnedBotLifecyclePort} from './owned-bot-lifecycle.mjs';

const ownedReadPorts=new WeakMap();
/** A brand check grants no authority and cannot construct a retained owner port. */
export const isOwnedBotTaskReadPort=port=>ownedReadPorts.has(port);
/** Boolean same-Host/owner proof; retained authority stays in private metadata. */
export const isOwnedBotTaskReadPortForHost=(port,host,caller)=>{
 const retained=ownedReadPorts.get(port);
 return retained!==undefined && retained.host===host && retained.caller===caller;
};

function route(value) {
  requireValue(value && Object.keys(value).every(k=>['provider','model','reasoning'].includes(k)),'invalid_config','Only nonsecret model route fields are accepted');
  return {provider:text(value.provider,'provider',100),model:text(value.model,'model',200),reasoning:value.reasoning==null ? null:text(value.reasoning,'reasoning',40)};
}
function config(value,adapter,previous) {
  requireValue(value && Object.keys(value).every(k=>['contact','execution','sessionModes','autonomy','agentPreset'].includes(k)),'invalid_config');
  const sessionModes=value.sessionModes ?? previous?.sessionModes ?? {plan:null,permissions:null};
  requireValue(sessionModes && Object.keys(sessionModes).every(k=>['plan','permissions'].includes(k)),'invalid_config');
  requireValue(sessionModes.plan==null && sessionModes.permissions==null,'unsupported_session_mode','Plan and permission writes remain independently unsupported');
  const explicit=Object.hasOwn(value,'agentPreset'),agentPreset=explicit?value.agentPreset:previous?.agentPreset ?? null;
  if(explicit && agentPreset!==null)requireHealthyPreset(adapter.sessionModeCatalog?.(),agentPreset);
  const contact=route(value.contact); return {contact,execution:value.execution ? route(value.execution):contact,sessionModes:{plan:null,permissions:null},agentPreset,autonomy:autonomyPolicy(value.autonomy)};
}
export class Host {
  #ownerCapability;
  #workSessions;
  #controlDispatch;
  #controlHostInstanceId=randomUUID();
  constructor({ledger,ownerHumanId,adapter=new DshAdapter(),ownerCapability,workSessionRuntime}) {
    this.#ownerCapability=ownerCapability;
    this.ledger=ledger; this.ownerHumanId=text(ownerHumanId,'ownerHumanId',200); this.adapter=adapter;
    this.ledgerInstanceId=ledger.transaction(()=>{
      const owner=ledger.get('meta','owner');requireValue(!owner || owner.id===ownerHumanId,'owner_mismatch');
      if(!owner){ledger.put('meta','owner',{id:ownerHumanId});if(ownerCapability===undefined)ledger.put('grant','root',{id:'root',actor:{kind:'human',id:ownerHumanId},epoch:1,active:true,authority:'configured-human-entry',scope:'local-control-ledger'});}
      return (ledger.get('meta','instance') ?? ledger.put('meta','instance',{id:randomUUID()})).id;
    });
    if(ownerCapability!==undefined)ledger.transaction(()=>{
      const existing=ledger.get('grant','native-owner');
      if(!existing)ledger.put('grant','native-owner',{id:'native-owner',actor:{kind:'host',id:this.ledgerInstanceId},epoch:1,active:true,authority:'private-runtime-owner',scope:'owned-text-sessions'});
    });
    registerCollaboration(this); registerProgression(this);
    this.#workSessions=createWorkSessionManager(this,{runtime:workSessionRuntime,authorize:caller=>requireValue(this.#ownerCapability!==undefined&&caller===this.#ownerCapability,'unsupported_host_identity'),createTask:(p,id)=>this.#createTaskRecord(p,id)});
  }
  openOwnedWorkSessionPort(caller,options){return this.#workSessions.open(caller,options);}
  /** Exact private owner lifecycle. Ordinary ledger commands cannot invoke native archival. */
  async openOwnedBotLifecyclePort(caller,options){const authorize=()=>requireValue(this.#ownerCapability!==undefined&&caller===this.#ownerCapability,'unsupported_host_identity');authorize();return createOwnedBotLifecyclePort(this,caller,options,this.#workSessions,authorize);}
  #createTaskRecord(p,taskId=randomUUID()){
    const b=this.object('bot',p.ownerBotId);requireValue(b.lifecycle==='active','owner_unavailable');
    requireValue(p.scope&&typeof p.scope.namespace==='string'&&Array.isArray(p.scope.writeResources),'invalid_scope');
    return this.save('task',{taskId,ownerBotId:b.botId,ownerBotEpoch:b.epoch,title:text(p.title,'title',500),scope:p.scope,acceptance:text(p.acceptance,'acceptance'),acceptanceVersion:1,epoch:1,revision:1,responsibility:'open',pendingRevision:null,stop:{state:'none'},dependencies:p.dependencies??[]});
  }
  actor(actor) { requireValue(actor?.kind==='human' && actor.id===this.ownerHumanId,'unauthorized','Trusted human entry required; bot execution bridge is unavailable'); return {kind:'human',id:actor.id}; }
  object(kind,id,e) {
    const o=this.ledger.get(kind,text(id,`${kind}Id`,200)); requireValue(o,'not_found');
    if(e) {requireValue(e.expectedRevision===o.revision,'revision_conflict'); if(e.expectedEpochs[kind]!==undefined) requireValue(e.expectedEpochs[kind]===o.epoch,'epoch_conflict');}
    return o;
  }
  save(kind,o) { return this.ledger.put(kind,(kind==='progress' ? o.planId : o[`${kind}Id`]) ?? o.id,o); }
  taskOwner(t) {
    const b=this.object('bot',t.ownerBotId);
    requireValue(b.lifecycle==='active','owner_unavailable');
    requireValue(t.ownerBotEpoch===b.epoch,'owner_epoch_conflict','Archived or unbound responsibility requires an explicit new task');
    return b;
  }
  execute(inputActor,e,payload) {
    const actor=this.actor(inputActor);
    return this.#execute(actor,e,payload);
  }
  /** Private launcher capability entry; serialized actor fields cannot grant owner authority. */
  executeOwned(caller,e,payload) {
    requireValue(this.#ownerCapability!==undefined && caller===this.#ownerCapability,'unsupported_host_identity');
    requireValue(e?.authorizationRef==='native-owner','unauthorized');
    return this.#execute({kind:'host',id:this.ledgerInstanceId},e,payload);
  }
  /** Owner-only retained management port; an ID never grants invocation authority. */
  openOwnedControlSession(caller,options) {
    requireValue(this.#ownerCapability!==undefined && caller===this.#ownerCapability,'unsupported_host_identity');
    requireValue(options && typeof options==='object' && Object.keys(options).every(k=>['envelope','payload','isCurrent'].includes(k)),'invalid_control_session');
    const isCurrent=options.isCurrent ?? (()=>true);
    requireValue(typeof isCurrent==='function','invalid_control_session');
    const id=text(options.payload?.controlSessionId,'controlSessionId',200);
    requireValue(id===options.payload.controlSessionId,'invalid_control_session');
    const lease={controlSessionId:id,authorityEpoch:options.envelope?.expectedEpochs?.nativeOwner,isCurrent,fenced:false,disposed:false};
    this.#dispatchControl(caller,options.envelope,options.payload,lease,'openControlSession',true);
    return Object.freeze({controlSessionId:id,
      selectExistingBot:(e,p)=>this.#dispatchControl(caller,e,p,lease,'selectExistingBot'),
      createBot:(e,p)=>this.#dispatchControl(caller,e,p,lease,'createBot'),
      query:(e,p)=>this.#dispatchControl(caller,e,p,lease,'queryControlSession'),
      dispose:(e,p)=>this.#dispatchControl(caller,e,p,lease,'disposeControlSession')});
  }
  #dispatchControl(caller,e,p,lease,command,opening=false) {
    requireValue(this.#controlDispatch===undefined,'control_in_progress');
    requireValue(e?.command===command,'unsupported_command');
    requireValue(p?.controlSessionId===lease.controlSessionId,'control_identity_conflict');
    this.#controlDispatch={caller,e,p,lease,opening,authorized:false};
    try{return this.executeOwned(caller,e,p);}finally{this.#controlDispatch=undefined;}
  }
  #authorizeControl(lease,caller) {
    requireValue(!lease.disposed,'control_session_disposed');
    requireValue(!lease.fenced,'control_session_fenced');
    try {
      requireValue(caller===this.#ownerCapability && this.#ownerCapability!==undefined,'unsupported_host_identity');
      let current;try{current=lease.isCurrent();}catch{current=false;}
      // Async authorization is refused synchronously; consume a rejected Promise safely.
      if(current && typeof current.then==='function')Promise.resolve(current).catch(()=>{});
      requireValue(current===true,'unauthorized');
      const g=this.ledger.get('grant','native-owner');
      requireValue(g?.active===true && g.actor?.kind==='host' && g.actor.id===this.ledgerInstanceId
        && g.authority==='private-runtime-owner' && g.scope==='owned-text-sessions'
        && Number.isSafeInteger(lease.authorityEpoch) && lease.authorityEpoch>=1 && g.epoch===lease.authorityEpoch,'unauthorized');
    } catch(error) {lease.fenced=true;throw error;}
  }
  #controlContext(p,e,actor) {
    const d=this.#controlDispatch;
    requireValue(d && d.e===e && d.p===p && d.caller===this.#ownerCapability && actor?.kind==='host' && actor.id===this.ledgerInstanceId,'unsupported_host_identity');
    if(!d.authorized){this.#authorizeControl(d.lease,d.caller);d.authorized=true;}
    requireValue(e.ledgerInstanceId===this.ledgerInstanceId,'ledger_identity_conflict');
    requireValue(e.authorizationRef==='native-owner','unauthorized');
    requireValue(p.controlSessionId===d.lease.controlSessionId,'control_identity_conflict');
    requireValue(e.expectedEpochs?.nativeOwner===d.lease.authorityEpoch,'epoch_conflict');
    const c=this.ledger.get('control',p.controlSessionId);
    if(c) {
      requireValue(c.hostInstanceId===this.#controlHostInstanceId,'unsupported_host_identity');
      requireValue(c.ledgerInstanceId===this.ledgerInstanceId && c.ownerHumanId===this.ownerHumanId,'unauthorized');
      requireValue(c.authorityEpoch===d.lease.authorityEpoch,'unauthorized');
      if(c.state!=='open'){d.lease.disposed=true;requireValue(false,'control_session_disposed');}
      if(!d.opening)requireValue(e.expectedEpochs.control===c.epoch,'epoch_conflict');
    } else requireValue(d.opening,'not_found');
    return c;
  }
  #controlPayload(p,keys) {
    requireValue(p && Object.getPrototypeOf(p)===Object.prototype && Object.keys(p).every(k=>keys.includes(k)),'invalid_control_session');
  }
  #controlState(c) {
    return {controlSessionId:c.controlSessionId,state:c.state,revision:c.revision,epoch:c.epoch,authorityEpoch:c.authorityEpoch,
      memberCount:Object.keys(c.members).length,selectedBotId:c.selectedBotId};
  }
  #controlBot(b) {
    const cfg=this.object('config',b.configVersion);
    const route=value=>({provider:value.provider,model:value.model,reasoning:value.reasoning ?? null});
    return {...projectBotTaskSnapshot({bot:[b],task:[]}).bot[0],configVersion:b.configVersion,
      config:{contact:route(cfg.contact),execution:route(cfg.execution),agentPreset:cfg.agentPreset ?? null}};
  }
  #controlSelection(p,e,c) {
    const b=this.object('bot',p.botId);
    requireValue(b.ownerHumanId===c.ownerHumanId,'unauthorized');
    requireValue(e.expectedEpochs.bot===b.epoch,'epoch_conflict');
    requireValue(b.lifecycle==='active','owner_unavailable');
    return b;
  }
  #controlQuery(p,e,c) {
    const valid=ids=>Array.isArray(ids) && ids.length<=500 && Array.from(ids).every(id=>typeof id==='string' && id.length>0 && id.length<=200) && new Set(ids).size===ids.length;
    requireValue(valid(p.botIds) && valid(p.taskIds),'invalid_read_scope');
    for(const id of p.botIds) {
      const b=this.object('bot',id),ref=Object.hasOwn(c.members,id)?c.members[id]:null;
      requireValue(ref && b.ownerHumanId===c.ownerHumanId,'unauthorized');
      requireValue(e.expectedEpochs[`bot:${id}`]===b.epoch && ref.botEpoch===b.epoch,'epoch_conflict');
      requireValue(ref.configVersion===b.configVersion,'configuration_conflict');
    }
    const rows=this.snapshotOwnedBotTasks(this.#ownerCapability,{authorityEpoch:c.authorityEpoch,botIds:p.botIds,taskIds:p.taskIds});
    return {...this.#controlState(c),bot:rows.bot.map(b=>this.#controlBot(b)),task:projectBotTaskSnapshot(rows).task};
  }
  #managementPreflight(p,e,actor) {
    const c=this.#controlContext(p,e,actor);
    const allowed={openControlSession:['controlSessionId'],selectExistingBot:['controlSessionId','botId','expectedBotRevision'],
      createBot:['controlSessionId','name','config'],queryControlSession:['controlSessionId','botIds','taskIds'],disposeControlSession:['controlSessionId']};
    this.#controlPayload(p,allowed[e.command] ?? []);
    if(e.command==='openControlSession')requireValue(e.expectedRevision===null,'revision_conflict');
    if(e.command==='selectExistingBot')this.#controlSelection(p,e,c);
    if(e.command==='queryControlSession'){this.#controlQuery(p,e,c);requireValue(e.expectedRevision===c.revision,'revision_conflict');}
    return c;
  }
  #controlMember(c,b) {
    const updated={...c,revision:c.revision+1,selectedBotId:b.botId,
      members:{...c.members,[b.botId]:{botId:b.botId,botEpoch:b.epoch,configVersion:b.configVersion}}};
    this.save('control',updated);return {...this.#controlState(updated),bot:this.#controlBot(b)};
  }
  /** Creation policy only; durable grant metadata is not an invocation capability. */
  isCreationOwnerGrant(grant) {
    return grant?.actor.kind==='human' && grant.actor.id===this.ownerHumanId
      || this.#ownerCapability!==undefined && grant?.authority==='private-runtime-owner'
        && grant.actor.kind==='host' && grant.actor.id===this.ledgerInstanceId;
  }
  #execute(actor,e,payload) {
    requireValue(e && typeof e==='object','invalid_envelope');
    this.#workSessions.preflight(actor,e,payload);
    if(['openControlSession','selectExistingBot','queryControlSession','disposeControlSession'].includes(e.command) || (payload && Object.hasOwn(payload,'controlSessionId')))this.#managementPreflight(payload,e,actor);
    if(e.ledgerInstanceId!==undefined) requireValue(e.ledgerInstanceId===this.ledgerInstanceId,'ledger_identity_conflict');
    for(const key of ['operationId','nonce','command','payloadDigest','rootHumanInstructionRef','authorizationRef','createdAt']) text(e[key],key,250);
    requireValue(e.expectedRevision===null || Number.isSafeInteger(e.expectedRevision),'invalid_envelope');
    requireValue(e.expectedEpochs && typeof e.expectedEpochs==='object' && !Array.isArray(e.expectedEpochs),'invalid_envelope');
    requireValue(Number.isFinite(Date.parse(e.createdAt)),'invalid_envelope');
    requireValue(e.deadline===null || (typeof e.deadline==='string' && Number.isFinite(Date.parse(e.deadline))),'invalid_envelope');
    if(e.authenticatedActor) requireValue(canonical(actor)===canonical(e.authenticatedActor),'actor_conflict');
    const grant=this.ledger.get('grant',e.authorizationRef);
    requireValue(grant && canonical(grant.actor)===canonical(actor) && (grant.active || ['inspectOperation','stopTask','stopContactCreation','stopNativeTextOperation'].includes(e.command)),'unauthorized');
    const fn=Object.hasOwn(this.commands,e.command) ? this.commands[e.command] : Object.hasOwn(this.extensions,e.command) ? this.extensions[e.command] : null; requireValue(fn,'unsupported_command');
    return this.ledger.operation(actor,e,payload,()=>fn.call(this,payload,e,actor));
  }
  snapshot(inputActor) {
    this.actor(inputActor);
    const kinds=['bot','config','conversation','group','meeting','task','attempt','message','delivery','outbox','resource','grant','progress','creation'];
    return {ledgerInstanceId:this.ledgerInstanceId,host:'disconnected',nativeRuntimeVerified:false,releaseReady:false,version:'0.1.0-alpha.1',capabilities:this.adapter.capabilities(),agentPresetCatalog:this.adapter.sessionModeCatalog?.() ?? emptyPresetCatalog(),observedAt:new Date().toISOString(),...Object.fromEntries(kinds.map(k=>[k,k==='meeting'?this.ledger.list(k).map(m=>this.publicMeeting(m.meetingId)):this.ledger.list(k)]))};
  }
  /**
   * Read exact Bot/task keys for the retained private owner capability.
   * @param caller Existing opaque owner capability; never a serialized actor.
   * @param scope Host-selected IDs and captured native-owner grant epoch.
   * @returns Existing Bot/task records only. No ledger initialization or writes.
   */
  snapshotOwnedBotTasks(caller,scope) {
    requireValue(this.#ownerCapability!==undefined && caller===this.#ownerCapability,'unsupported_host_identity');
    const grant=this.ledger.get('grant','native-owner');
    requireValue(grant?.active===true && grant.actor?.kind==='host' && grant.actor.id===this.ledgerInstanceId
      && grant.authority==='private-runtime-owner' && grant.scope==='owned-text-sessions'
      && Number.isSafeInteger(scope?.authorityEpoch) && scope.authorityEpoch>=1 && grant.epoch===scope.authorityEpoch,'unauthorized');
    const validIds=ids=>Array.isArray(ids) && ids.length<=500 && Array.from(ids).every(id=>typeof id==='string' && id.length>0 && id.length<=200)
      && new Set(ids).size===ids.length;
    requireValue(validIds(scope.botIds) && validIds(scope.taskIds),'unauthorized');
    const botIds=new Set(scope.botIds);
    const bot=scope.botIds.map(id=>{const row=this.ledger.get('bot',id);requireValue(row?.botId===id,'unauthorized');return row;});
    const task=scope.taskIds.map(id=>{const row=this.ledger.get('task',id);requireValue(row?.taskId===id && botIds.has(row.ownerBotId),'unauthorized');return row;});
    return {bot,task};
  }
  /** Retain existing owner authority without exposing its caller, ledger or commands. */
  createOwnedBotTaskReadPort(caller,{isCurrent=()=>true}={}) {
    requireValue(this.#ownerCapability!==undefined && caller===this.#ownerCapability,'unsupported_host_identity');
    requireValue(typeof isCurrent==='function','invalid_read_source');
    const authorityEpoch=this.ledger.get('grant','native-owner')?.epoch;
    const port=Object.freeze({snapshot:({botIds,taskIds})=>{
      requireValue(isCurrent()===true,'unauthorized');
      const dto=projectBotTaskSnapshot(this.snapshotOwnedBotTasks(caller,{authorityEpoch,botIds,taskIds}));
      requireValue(isCurrent()===true,'unauthorized');
      return {bot:dto.bot,task:dto.task};
    }});
    ownedReadPorts.set(port,{host:this,caller});return port;
  }
  async refreshSessionModeCatalog(inputActor) {
    this.actor(inputActor);
    return this.adapter.refreshSessionModeCatalog ? await this.adapter.refreshSessionModeCatalog() : emptyPresetCatalog();
  }
  commands={
    openControlSession(p,e,actor) {
      this.#managementPreflight(p,e,actor);
      requireValue(!this.ledger.get('control',p.controlSessionId),'control_session_exists');
      const c={id:p.controlSessionId,controlSessionId:p.controlSessionId,ledgerInstanceId:this.ledgerInstanceId,hostInstanceId:this.#controlHostInstanceId,
        ownerHumanId:this.ownerHumanId,authorityEpoch:e.expectedEpochs.nativeOwner,state:'open',epoch:1,revision:1,members:{},selectedBotId:null};
      this.save('control',c);return this.#controlState(c);
    },
    selectExistingBot(p,e,actor) {
      const c=this.#managementPreflight(p,e,actor);this.object('control',p.controlSessionId,e);
      const b=this.#controlSelection(p,e,c);requireValue(p.expectedBotRevision===b.revision,'revision_conflict');
      return this.#controlMember(c,b);
    },
    queryControlSession(p,e,actor) {
      const c=this.#managementPreflight(p,e,actor);this.object('control',p.controlSessionId,e);
      return this.#controlQuery(p,e,c);
    },
    disposeControlSession(p,e,actor) {
      const c=this.#managementPreflight(p,e,actor);this.object('control',p.controlSessionId,e);
      const disposed={...c,state:'disposed',epoch:c.epoch+1,revision:c.revision+1};
      this.save('control',disposed);return this.#controlState(disposed);
    },
    prepareContactSession(p,e) {
      const b=this.object('bot',p.botId,e);requireValue(b.lifecycle==='active','owner_unavailable');
      requireValue(!b.creationIntentId && b.contactSessionId===null,'contact_creation_exists');
      const cfg=this.ledger.get('config',b.configVersion),request=prepareSessionCreate({cwd:p.cwd,agentPreset:cfg.agentPreset ?? null},this.adapter.sessionModeCatalog()).request;
      const grant=this.ledger.get('grant',e.authorizationRef);
      const intent={operationId:e.operationId,nonce:e.nonce,sessionId:`session-${randomUUID()}`,botId:b.botId,botEpoch:b.epoch,configVersion:b.configVersion,authorizationRef:e.authorizationRef,authorityEpoch:grant.epoch,rootHumanInstructionRef:e.rootHumanInstructionRef,deadline:e.deadline,...request,state:'prepared'};
      this.ledger.put('creation',e.operationId,intent);this.save('bot',{...b,creationIntentId:e.operationId,revision:b.revision+1});return intent;
    },
    stopContactCreation(p) {
      const i=this.object('creation',p.operationId);
      return this.ledger.put('creation',i.operationId,{...i,stopped:true,state:'fenced',errorCategory:'creation_stopped'});
    },
    createBot(p,e,actor) {
      const control=Object.hasOwn(p,'controlSessionId')?this.#managementPreflight(p,e,actor):null;
      if(control)this.object('control',p.controlSessionId,e);
      const botId=randomUUID(), configVersion=randomUUID();
      this.ledger.put('config',configVersion,{id:configVersion,...config(p.config,this.adapter),createdAt:e.createdAt});
      const conversationId=randomUUID();
      this.ledger.put('conversation',conversationId,{conversationId,kind:'contact',botId,groupId:null,sessionId:null,epoch:1,revision:1});
      const b=this.save('bot',{botId,name:text(p.name,'name',100),ownerHumanId:this.ownerHumanId,lifecycle:'active',readiness:'registered',epoch:1,revision:1,configVersion,contactConversationId:conversationId,contactSessionId:null,nativeStatus:'unsupported'});
      return control?this.#controlMember(control,b):b;
    },
    updateBotConfig(p,e) {
      const b=this.object('bot',p.botId,e), id=randomUUID();
      this.ledger.put('config',id,{id,...config(p.config,this.adapter,this.ledger.get('config',b.configVersion)),createdAt:e.createdAt});
      return this.save('bot',{...b,configVersion:id,revision:b.revision+1});
    },
    createTask(p) { return this.#createTaskRecord(p); },
    startAttempt(p,e) {
      const t=this.object('task',p.taskId,e), b=this.object('bot',t.ownerBotId);
      requireValue(t.stop.state==='none','task_stopped');requireValue(!t.pendingRevision,'revision_pending');requireValue(t.responsibility!=='verified','task_complete');
      const blockers=REQUIRED_NATIVE.map(capability=>({code:'unsupported',capability,reason:'Native dispatch is disabled in this alpha; isolated live proof required'}));
      if(b.lifecycle!=='active') blockers.push({code:'owner_unavailable'});
      if(t.ownerBotEpoch!==b.epoch) blockers.push({code:'owner_epoch_conflict'});
      for(const dep of t.dependencies) if(this.ledger.get('task',dep)?.responsibility!=='verified') blockers.push({code:'blocked_dependency',taskId:dep});
      const existing=this.ledger.list('attempt').filter(a=>a.taskId===t.taskId);
      if(existing.some(a=>['outcome_unknown','admitted','running','settling'].includes(a.execution))) blockers.push({code:'outcome_unknown',reason:'Previous execution lacks settlement evidence'});
      const a={attemptId:randomUUID(),taskId:t.taskId,ordinal:existing.length+1,sessionId:null,runGeneration:null,fence:1,epoch:t.epoch,taskRevision:t.revision,botEpoch:b.epoch,authorityEpoch:this.ledger.get('grant',e.authorizationRef).epoch,configSnapshot:this.ledger.get('config',b.configVersion),execution:'queued',blockers,stop:{state:'none'},leaseUntil:null,observedAt:new Date().toISOString()};
      this.save('attempt',a); this.save('task',{...t,revision:t.revision+1,responsibility:'blocked'}); return a;
    },
    adjustTask(p,e) {
      const t=this.object('task',p.taskId,e);
      const pendingRevision={title:p.title ? text(p.title,'title',500):t.title,acceptance:p.acceptance ? text(p.acceptance,'acceptance'):t.acceptance,reason:'Old attempt settlement and native admission required before activation'};
      return this.save('task',{...t,pendingRevision,revision:t.revision+1});
    },
    stopTask(p,e) {
      const t=this.object('task',p.taskId,e);
      const targets=this.ledger.list('attempt').filter(a=>a.taskId===t.taskId).map(a=>({attemptId:a.attemptId,sessionId:a.sessionId,runGeneration:a.runGeneration}));
      for(const a of this.ledger.list('attempt').filter(a=>a.taskId===t.taskId)) this.save('attempt',{...a,fence:a.fence+1,stop:{state:'unsupported',target:{sessionId:a.sessionId,runGeneration:a.runGeneration}}});
      for(const o of this.ledger.list('outbox').filter(o=>o.taskId===t.taskId && o.state==='ready')) this.save('outbox',{...o,state:'revoked'});
      return this.save('task',{...t,epoch:t.epoch+1,revision:t.revision+1,stop:{state:'unsupported',operationId:e.operationId,targets,reason:'Run-addressed native tree stop unavailable'}});
    },
    archive(p,e) {
      requireValue(p.kind==='bot','unsupported','Native session archival unavailable'); const b=this.object('bot',p.id,e);
      if(b.lifecycle==='archived') return b;
      for(const t of this.ledger.list('task').filter(t=>t.ownerBotId===b.botId && t.responsibility!=='verified')) {
        this.save('task',{...t,epoch:t.epoch+1,revision:t.revision+1,ownerInvalidation:{botEpoch:b.epoch,operationId:e.operationId,reason:'bot_archived'}});
      }
      const ownedTasks=new Set(this.ledger.list('task').filter(t=>t.ownerBotId===b.botId).map(t=>t.taskId));
      for(const a of this.ledger.list('attempt').filter(a=>ownedTasks.has(a.taskId) && !['settled','failed'].includes(a.execution))) this.save('attempt',{...a,fence:a.fence+1,stop:{state:'unsupported',target:{sessionId:a.sessionId,runGeneration:a.runGeneration},reason:'Native settlement remains unproven'}});
      for(const kind of ['delivery','outbox']) for(const d of this.ledger.list(kind).filter(d=>d.botId===b.botId && !['consumed','replied','confirmed','failed','revoked'].includes(d.state))) {
        this.save(kind,{...d,state:d.state==='outcome_unknown'?d.state:'revoked',revoked:true,revocationReason:'bot_archived',revokedBotEpoch:b.epoch});
      }
      return this.save('bot',{...b,lifecycle:'archived',epoch:b.epoch+1,revision:b.revision+1,nativeArchive:'unsupported',stop:'unsupported'});
    },
    restore(p,e) {
      requireValue(p.kind==='bot','unsupported','Native restore requires verified complete log inspection'); const b=this.object('bot',p.id,e);
      requireValue(b.lifecycle==='archived','lifecycle_conflict');
      requireValue(b.contactSessionId===null,'unsupported','Native log readability cannot be proven in alpha');
      return this.save('bot',{...b,lifecycle:'active',readiness:'registered',epoch:b.epoch+1,revision:b.revision+1,nativeRestore:'unsupported'});
    },
    inspectOperation(p,e,actor) { return this.ledger.inspectOperation(actor,p.operationId); },
    revoke(p) { requireValue(p.grantId==='root','not_found'); const g=this.ledger.get('grant','root'); return this.ledger.put('grant','root',{...g,epoch:g.epoch+1,active:false}); }
  };
}
