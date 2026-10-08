import {canonical, copy, plain, requireCondition, validId} from './store.mjs';

const tables = {bot:'bots',session:'sessions',memory:'memories',task:'tasks',group:'groups',meeting:'meetings'};
const scopeKeys = {session:'sessions',memory:'memories',task:'tasks'};
const humanOnly = new Set(['bot.create','bot.update','share.set','grant.set','group.members']);
const controllable = new Set(['session.create','session.send','session.archive','session.restore','task.create','task.start','task.adjust','task.stop','task.archive','task.restore','task.accept']);
export const defaultShare = () => ({enabled:true,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*']}});
function validScope(scope) {
  return plain(scope) && Object.keys(scope).every(key => Object.values(scopeKeys).includes(key)) &&
    Object.values(scope).every(ids => Array.isArray(ids) && ids.length <= 10000 && ids.every(id => id === '*' || validId(id)));
}
function includes(scope, resource) {const list = scope?.[scopeKeys[resource.kind]]; return Array.isArray(list) && (list.includes('*') || list.includes(resource.id));}

/** Caller tokens are process-local; neither labels nor serialized actors count. */
export class PermissionPolicy {
  #store; #agents; #operator; #actors = new WeakSet(); #reads = new WeakMap();
  constructor(store,{agents,operatorPeer} = {}) {this.#store=store;this.#agents=agents;this.#operator=operatorPeer;}
  fromPeer(peer) {
    requireCondition(peer && peer === this.#operator,'access_denied');
    const actor=Object.freeze({kind:'human'});this.#actors.add(actor);return actor;
  }
  fromAgent(agent) {
    const binding=this.#store.read().sessions[agent?.id];
    requireCondition(agent && this.#agents?.get(agent.id) === agent && binding?.botId,'access_denied');
    const actor=Object.freeze({kind:'bot',botId:binding.botId,sessionId:agent.id,agent});this.#actors.add(actor);return actor;
  }
  actorKey(actor) {this.#checkActor(actor,this.#store.read());return actor.kind==='human'?'human':canonical(['bot',actor.botId,actor.sessionId]);}
  command(actor,command) {return {...copy(command),callerKey:this.actorKey(actor)};}
  noteRead(actor,reference) {
    this.require(actor,`${reference.kind}.read`,reference);
    if(actor.kind==='human')return;
    const state=this.#store.read(),resource=this.resolve(reference,state),refs=this.#reads.get(actor.agent)??new Map();
    for(const ref of [...(resource.botId!==actor.botId?[reference]:[]),...(resource.record?.origins??[])])refs.set(canonical(ref),copy(ref));
    this.#reads.set(actor.agent,refs);
  }
  readDependencies(actor) {this.#checkActor(actor,this.#store.read());return actor.kind==='bot'?[...(this.#reads.get(actor.agent)?.values()??[])].map(copy):[];}
  canReadDerived(actor,record,state=this.#store.read()) {
    try{this.#checkActor(actor,state);return this.#visible(actor,{kind:'memory',id:'derived',record,botId:record.botId??record.ownerBotId??null},state);}catch{return false;}
  }
  noteDependencies(actor,references=[]) {for(const reference of references)this.noteRead(actor,reference);}
  #checkActor(actor,state) {
    requireCondition(actor && this.#actors.has(actor),'access_denied');
    if(actor.kind==='bot')requireCondition(this.#agents?.get(actor.sessionId)===actor.agent && state.sessions[actor.sessionId]?.botId===actor.botId,'access_denied');
  }
  resolve(resource,state=this.#store.read()) {
    requireCondition(plain(resource) && tables[resource.kind] && validId(resource.id),'invalid_resource');
    const record=state[tables[resource.kind]][resource.id];
    return {kind:resource.kind,id:resource.id,record,botId:resource.kind==='bot'?record?.botId:record?.botId ?? record?.ownerBotId ?? null};
  }
  #visible(actor,resource,state,seen=new Set()) {
    if(actor.kind==='human')return true;
    const record=resource.record, binding=state.sessions[actor.sessionId];
    for(const origin of record?.origins??[]) {
      if(!this.#readAllowed(actor,origin,state,seen))return false;
    }
    const sources=[record?.lineage,...(Array.isArray(record?.source)?record.source:[record?.source])];
    for(const source of [...sources].filter(Boolean))if(source.sessionId && state.sessions[source.sessionId]?.lineage)sources.push(state.sessions[source.sessionId].lineage);
    for(const lineage of sources.filter(Boolean)) {
      if(!lineage.meetingId || lineage.phase!=='independent')continue;
      const meeting=state.meetings[lineage.meetingId];
      if(!meeting || meeting.epoch!==lineage.epoch)return false;
      if(lineage.memberEpoch!==undefined){const participant=meeting.participants?.find(row=>row.botId===lineage.botId);if(!participant?.active||participant.memberEpoch!==lineage.memberEpoch)return false;}
      if(!['discussion','decision','complete'].includes(meeting.phase)) {
        if(meeting.phase!=='independent')return false;
        const ownChannel=binding?.lineage?.meetingId===lineage.meetingId && binding.lineage.epoch===lineage.epoch &&
          binding.lineage.phase==='independent' && resource.botId===actor.botId &&
          (resource.kind==='session'?resource.id===actor.sessionId:lineage.sessionId===actor.sessionId);
        if(!ownChannel)return false;
      }
    }
    if(resource.kind==='group')return record?.members?.some(member=>member.botId===actor.botId && member.active);
    if(resource.kind==='meeting')return record?.participants?.some(member=>member.botId===actor.botId && member.active);
    return true;
  }
  #shareAllowed(actor,resource,state) {
    const share=state.bots[resource.botId]?.share ?? defaultShare();
    return share.enabled===true && share.receivers?.some(id=>id==='*'||id===actor.botId) && includes(share.scope,resource);
  }
  #grant(actor,resource,state,level) {
    return Object.values(state.grants).some(grant=>grant.active===true && grant.recipientBotId===actor.botId && grant.ownerBotId===resource.botId &&
      (level==='read'||grant.level==='control') && includes(grant.scope,resource));
  }
  canRead(actor,reference,_context,state=this.#store.read()) {
    try {
      this.#checkActor(actor,state);return this.#readAllowed(actor,reference,state,new Set());
    }catch{return false;}
  }
  #readAllowed(actor,reference,state,seen) {
    const key=canonical(reference);if(seen.has(key)||seen.size>=32)return false;
    const next=new Set(seen);next.add(key);
    const resource=this.resolve(reference,state);
    if(!this.#visible(actor,resource,state,next))return false;
    if(actor.kind==='human')return true;
    if(resource.kind==='group'||resource.kind==='meeting'||resource.kind==='bot')return !!resource.record;
    if(resource.botId===actor.botId)return true;
    if(!resource.botId)return this.#grant(actor,resource,state,'read');
    return this.#shareAllowed(actor,resource,state);
  }
  require(actor,action,reference,state=this.#store.read()) {
    this.#checkActor(actor,state);
    this.#requirePrincipal(actor,action,reference,state);
  }
  #requirePrincipal(actor,action,reference,state) {
    if(actor.kind==='human')return;
    requireCondition(!humanOnly.has(action),'access_denied');
    const resource=this.resolve(reference,state);
    requireCondition(this.#readAllowed(actor,reference,state,new Set()),'access_denied');
    if(action.endsWith('.read'))return;
    if(action.startsWith('memory.')) {requireCondition(resource.botId===actor.botId,'access_denied');return;}
    if(['group.post','meeting.start','meeting.opinion'].includes(action)) {requireCondition(this.#visible(actor,resource,state),'access_denied');return;}
    requireCondition(controllable.has(action),'access_denied');
    if(resource.botId===actor.botId)return;
    requireCondition((!resource.botId || this.#shareAllowed(actor,resource,state)) && this.#grant(actor,resource,state,'control'),'access_denied');
  }
  /** A saved task result executes its original delivery intent, with current grants. */
  requireTaskResultDelivery(row,state=this.#store.read()) {
    const task=state.tasks[row.taskId],attempt=state.attempts[row.attemptId];
    requireCondition(row.kind==='result'&&task&&attempt?.taskId===task.taskId&&attempt.resultOutboxId===row.outboxId&&attempt.epoch===row.epoch&&task.originSessionId===row.sessionId,'delivery_identity_unknown');
    const principal=task.createdBy;
    requireCondition(plain(principal)&&['human','bot'].includes(principal.kind),'delivery_identity_unknown');
    if(principal.kind==='human')requireCondition(task.source?.kind==='human','delivery_identity_unknown');
    else requireCondition(validId(principal.botId)&&validId(principal.sessionId)&&task.source?.sessionId===principal.sessionId&&state.sessions[principal.sessionId]?.botId===principal.botId&&state.bots[principal.botId]?.lifecycle==='active','delivery_identity_unknown');
    this.#requirePrincipal(principal,'session.send',{kind:'session',id:row.sessionId},state);
  }
  async authorizeShare(actor,command) {
    command=copy(command);
    this.require(actor,command.action,{kind:'bot',id:command.input.botId??command.input.ownerBotId??'ordinary'});
    requireCondition(actor.kind==='human','access_denied');
    return this.#store.transact(this.command(actor,command),draft=>{
      this.#checkActor(actor,draft);const input=command.input;
      if(command.action==='share.set') {
        const bot=draft.bots[input.botId];requireCondition(bot,'not_found');
        requireCondition(plain(input.share) && typeof input.share.enabled==='boolean' && Array.isArray(input.share.receivers) && input.share.receivers.every(id=>id==='*'||validId(id)) && validScope(input.share.scope),'invalid_share');
        bot.share=copy(input.share);bot.revision++;return bot.share;
      }
      requireCondition(command.action==='grant.set' && validId(input.grantId) && validId(input.recipientBotId) &&
        (input.ownerBotId===null||validId(input.ownerBotId)) && ['read','control'].includes(input.level) && typeof input.active==='boolean' && validScope(input.scope),'invalid_grant');
      requireCondition(draft.bots[input.recipientBotId] && (input.ownerBotId===null||draft.bots[input.ownerBotId]),'not_found');
      const current=draft.grants[input.grantId];
      requireCondition(!current || current.ownerBotId===input.ownerBotId && current.recipientBotId===input.recipientBotId,'grant_identity_conflict');
      const grant={...copy(input),version:(current?.version??0)+1,grantedBy:'human'};draft.grants[input.grantId]=grant;return grant;
    });
  }
}
