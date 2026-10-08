import {copy, plain, requireCondition, validId} from './store.mjs';

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
  #store; #agents; #operator; #actors = new WeakSet();
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
  actorKey(actor) {this.#checkActor(actor,this.#store.read());return actor.kind==='human'?'human':`bot:${actor.botId}:${actor.sessionId}`;}
  command(actor,command) {return {...copy(command),callerKey:this.actorKey(actor)};}
  #checkActor(actor,state) {
    requireCondition(actor && this.#actors.has(actor),'access_denied');
    if(actor.kind==='bot')requireCondition(this.#agents?.get(actor.sessionId)===actor.agent && state.sessions[actor.sessionId]?.botId===actor.botId,'access_denied');
  }
  resolve(resource,state=this.#store.read()) {
    requireCondition(plain(resource) && tables[resource.kind] && validId(resource.id),'invalid_resource');
    const record=state[tables[resource.kind]][resource.id];
    return {kind:resource.kind,id:resource.id,record,botId:resource.kind==='bot'?record?.botId:record?.botId ?? record?.ownerBotId ?? null};
  }
  #visible(actor,resource,state) {
    if(actor.kind==='human')return true;
    const record=resource.record, binding=state.sessions[actor.sessionId];
    const source=record?.lineage ?? record?.source;
    const sources=Array.isArray(source)?source:[source];
    for(const lineage of sources.filter(Boolean)) {
      if(!lineage.meetingId || lineage.phase!=='independent')continue;
      const meeting=state.meetings[lineage.meetingId];
      if(!meeting || meeting.epoch!==lineage.epoch)return false;
      if(meeting.phase==='independent') {
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
    return Object.values(state.grants).some(grant=>grant.active && grant.recipientBotId===actor.botId && grant.ownerBotId===resource.botId &&
      (level==='read'||grant.level==='control') && includes(grant.scope,resource));
  }
  canRead(actor,reference,_context,state=this.#store.read()) {
    try {
      this.#checkActor(actor,state);const resource=this.resolve(reference,state);
      if(!this.#visible(actor,resource,state))return false;
      if(actor.kind==='human')return true;
      if(resource.kind==='group'||resource.kind==='meeting')return !!resource.record;
      if(resource.kind==='bot')return !!resource.record;
      if(resource.botId===actor.botId)return true;
      if(!resource.botId)return this.#grant(actor,resource,state,'read');
      return this.#shareAllowed(actor,resource,state);
    }catch{return false;}
  }
  require(actor,action,reference,state=this.#store.read()) {
    this.#checkActor(actor,state);
    if(actor.kind==='human')return;
    requireCondition(!humanOnly.has(action),'access_denied');
    const resource=this.resolve(reference,state);
    requireCondition(this.canRead(actor,reference,undefined,state),'access_denied');
    if(action.endsWith('.read'))return;
    if(action.startsWith('memory.')) {requireCondition(resource.botId===actor.botId,'access_denied');return;}
    if(['group.post','meeting.start','meeting.opinion'].includes(action)) {requireCondition(this.#visible(actor,resource,state),'access_denied');return;}
    requireCondition(controllable.has(action),'access_denied');
    if(resource.botId===actor.botId)return;
    requireCondition((!resource.botId || this.#shareAllowed(actor,resource,state)) && this.#grant(actor,resource,state,'control'),'access_denied');
  }
  async authorizeShare(actor,command) {
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
