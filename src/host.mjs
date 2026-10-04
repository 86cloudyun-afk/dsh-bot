import { randomUUID } from 'node:crypto';
import { canonical, text, requireValue, CommandError } from './errors.mjs';
import { DshAdapter, REQUIRED_NATIVE } from './adapter.mjs';
import { registerCollaboration } from './collaboration.mjs';
import { autonomyPolicy,registerProgression } from './progression.mjs';

function route(value) {
  requireValue(value && Object.keys(value).every(k=>['provider','model','reasoning'].includes(k)),'invalid_config','Only nonsecret model route fields are accepted');
  return {provider:text(value.provider,'provider',100),model:text(value.model,'model',200),reasoning:value.reasoning==null ? null:text(value.reasoning,'reasoning',40)};
}
function config(value) {
  requireValue(value && Object.keys(value).every(k=>['contact','execution','sessionModes','autonomy'].includes(k)),'invalid_config');
  const sessionModes=value.sessionModes ?? {plan:null,permissions:null};
  requireValue(sessionModes && Object.keys(sessionModes).every(k=>['plan','permissions'].includes(k)),'invalid_config');
  requireValue(sessionModes.plan==null && sessionModes.permissions==null,'unsupported_session_mode','Native mode catalog and user selection remain unverified');
  const contact=route(value.contact); return {contact,execution:value.execution ? route(value.execution):contact,sessionModes:{plan:null,permissions:null},autonomy:autonomyPolicy(value.autonomy)};
}
export class Host {
  constructor({ledger,ownerHumanId,adapter=new DshAdapter()}) {
    this.ledger=ledger; this.ownerHumanId=text(ownerHumanId,'ownerHumanId',200); this.adapter=adapter;
    const owner=ledger.get('meta','owner'); requireValue(!owner || owner.id===ownerHumanId,'owner_mismatch');
    if(!owner) ledger.transaction(()=>{ledger.put('meta','owner',{id:ownerHumanId}); ledger.put('grant','root',{id:'root',actor:{kind:'human',id:ownerHumanId},epoch:1,active:true,authority:'configured-human-entry',scope:'local-control-ledger'});});
    registerCollaboration(this); registerProgression(this);
  }
  actor(actor) { requireValue(actor?.kind==='human' && actor.id===this.ownerHumanId,'unauthorized','Trusted human entry required; bot execution bridge is unavailable'); return {kind:'human',id:actor.id}; }
  object(kind,id,e) {
    const o=this.ledger.get(kind,text(id,`${kind}Id`,200)); requireValue(o,'not_found');
    if(e) {requireValue(e.expectedRevision===o.revision,'revision_conflict'); if(e.expectedEpochs[kind]!==undefined) requireValue(e.expectedEpochs[kind]===o.epoch,'epoch_conflict');}
    return o;
  }
  save(kind,o) { return this.ledger.put(kind,(kind==='progress' ? o.planId : o[`${kind}Id`]) ?? o.id,o); }
  execute(inputActor,e,payload) {
    const actor=this.actor(inputActor);
    requireValue(e && typeof e==='object','invalid_envelope');
    for(const key of ['operationId','nonce','command','payloadDigest','rootHumanInstructionRef','authorizationRef','createdAt']) text(e[key],key,250);
    requireValue(e.expectedRevision===null || Number.isSafeInteger(e.expectedRevision),'invalid_envelope');
    requireValue(e.expectedEpochs && typeof e.expectedEpochs==='object' && !Array.isArray(e.expectedEpochs),'invalid_envelope');
    requireValue(Number.isFinite(Date.parse(e.createdAt)),'invalid_envelope');
    requireValue(e.deadline===null || (typeof e.deadline==='string' && Number.isFinite(Date.parse(e.deadline))),'invalid_envelope');
    if(e.authenticatedActor) requireValue(canonical(actor)===canonical(e.authenticatedActor),'actor_conflict');
    const grant=this.ledger.get('grant',e.authorizationRef);
    requireValue(grant && canonical(grant.actor)===canonical(actor) && (grant.active || ['inspectOperation','stopTask'].includes(e.command)),'unauthorized');
    const fn=Object.hasOwn(this.commands,e.command) ? this.commands[e.command] : Object.hasOwn(this.extensions,e.command) ? this.extensions[e.command] : null; requireValue(fn,'unsupported_command');
    return this.ledger.operation(actor,e,payload,()=>fn.call(this,payload,e,actor));
  }
  snapshot(inputActor) {
    this.actor(inputActor);
    const kinds=['bot','config','conversation','group','meeting','task','attempt','message','delivery','outbox','resource','grant','progress'];
    return {host:'disconnected',nativeRuntimeVerified:false,releaseReady:false,version:'0.1.0-alpha.1',capabilities:this.adapter.capabilities(),observedAt:new Date().toISOString(),...Object.fromEntries(kinds.map(k=>[k,k==='meeting'?this.ledger.list(k).map(m=>this.publicMeeting(m.meetingId)):this.ledger.list(k)]))};
  }
  commands={
    createBot(p,e) {
      const botId=randomUUID(), configVersion=randomUUID();
      this.ledger.put('config',configVersion,{id:configVersion,...config(p.config),createdAt:e.createdAt});
      const conversationId=randomUUID();
      this.ledger.put('conversation',conversationId,{conversationId,kind:'contact',botId,groupId:null,sessionId:null,epoch:1,revision:1});
      return this.save('bot',{botId,name:text(p.name,'name',100),ownerHumanId:this.ownerHumanId,lifecycle:'active',readiness:'registered',epoch:1,revision:1,configVersion,contactConversationId:conversationId,contactSessionId:null,nativeStatus:'unsupported'});
    },
    updateBotConfig(p,e) {
      const b=this.object('bot',p.botId,e), id=randomUUID();
      this.ledger.put('config',id,{id,...config(p.config),createdAt:e.createdAt});
      return this.save('bot',{...b,configVersion:id,revision:b.revision+1});
    },
    createTask(p) {
      const b=this.object('bot',p.ownerBotId); requireValue(b.lifecycle==='active','owner_unavailable');
      requireValue(p.scope && typeof p.scope.namespace==='string' && Array.isArray(p.scope.writeResources),'invalid_scope');
      return this.save('task',{taskId:randomUUID(),ownerBotId:b.botId,title:text(p.title,'title',500),scope:p.scope,acceptance:text(p.acceptance,'acceptance'),acceptanceVersion:1,epoch:1,revision:1,responsibility:'open',pendingRevision:null,stop:{state:'none'},dependencies:p.dependencies ?? []});
    },
    startAttempt(p,e) {
      const t=this.object('task',p.taskId,e), b=this.object('bot',t.ownerBotId);
      requireValue(t.stop.state==='none','task_stopped');requireValue(!t.pendingRevision,'revision_pending');requireValue(t.responsibility!=='verified','task_complete');
      const blockers=REQUIRED_NATIVE.map(capability=>({code:'unsupported',capability,reason:'Native dispatch is disabled in this alpha; isolated live proof required'}));
      if(b.lifecycle!=='active') blockers.push({code:'owner_unavailable'});
      for(const dep of t.dependencies) if(this.ledger.get('task',dep)?.responsibility!=='verified') blockers.push({code:'blocked_dependency',taskId:dep});
      const existing=this.ledger.list('attempt').filter(a=>a.taskId===t.taskId);
      if(existing.some(a=>['outcome_unknown','admitted','running','settling'].includes(a.execution))) blockers.push({code:'outcome_unknown',reason:'Previous execution lacks settlement evidence'});
      const a={attemptId:randomUUID(),taskId:t.taskId,ordinal:existing.length+1,sessionId:null,runGeneration:null,fence:1,epoch:t.epoch,taskRevision:t.revision,botEpoch:b.epoch,authorityEpoch:this.ledger.get('grant','root').epoch,configSnapshot:this.ledger.get('config',b.configVersion),execution:'queued',blockers,stop:{state:'none'},leaseUntil:null,observedAt:new Date().toISOString()};
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
      return this.save('bot',{...b,lifecycle:'archived',epoch:b.epoch+1,revision:b.revision+1,nativeArchive:'unsupported',stop:'unsupported'});
    },
    restore(p,e) {
      requireValue(p.kind==='bot','unsupported','Native restore requires verified complete log inspection'); const b=this.object('bot',p.id,e);
      requireValue(b.contactSessionId===null,'unsupported','Native log readability cannot be proven in alpha');
      return this.save('bot',{...b,lifecycle:'active',readiness:'registered',epoch:b.epoch+1,revision:b.revision+1,nativeRestore:'unsupported'});
    },
    inspectOperation(p,e,actor) { return this.ledger.inspectOperation(actor,p.operationId); },
    revoke(p) { requireValue(p.grantId==='root','not_found'); const g=this.ledger.get('grant','root'); return this.ledger.put('grant','root',{...g,epoch:g.epoch+1,active:false}); }
  };
}
