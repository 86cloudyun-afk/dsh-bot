import { randomUUID } from 'node:crypto';
import { digest,requireValue,text } from './errors.mjs';

function activeMember(group,botId) { const m=group.members[botId];requireValue(m?.active,'membership_revoked');return m; }
function canonicalTargets(host,group,names) {
  const bots=host.ledger.list('bot');
  return [...new Set(names.map(name=>{
    text(name,'recipient',200);const candidates=bots.filter(b=>b.botId===name || b.name.toLowerCase()===name.toLowerCase());
    requireValue(candidates.length===1,candidates.length ? 'ambiguous_target':'unknown_target');
    activeMember(group,candidates[0].botId);requireValue(candidates[0].lifecycle==='active','bot_unavailable');return candidates[0].botId;
  }))];
}
export function registerCollaboration(host) {
 host.extensions={
  createGroup(p) {
   requireValue(Array.isArray(p.members) && p.members.length>0 && p.members.length<=50,'invalid_members');
   const members={};for(const botId of [...new Set(p.members)]) {const b=this.object('bot',botId);requireValue(b.lifecycle==='active','bot_unavailable');members[botId]={generation:1,active:true};}
   requireValue(members[p.coordinatorBotId]?.active,'coordinator_required');
   return this.save('group',{groupId:randomUUID(),name:text(p.name,'name',100),namespace:text(p.namespace,'namespace',100),members,coordinatorBotId:p.coordinatorBotId,epoch:1,revision:1,ownerHumanId:this.ownerHumanId});
  },
  changeMembership(p,e) {
   const g=this.object('group',p.groupId,e),members=structuredClone(g.members);
   requireValue(Array.isArray(p.remove) && Array.isArray(p.add),'invalid_members');
   for(const id of p.remove) {requireValue(members[id],'unknown_target');members[id].active=false;}
   for(const id of p.add) {const b=this.object('bot',id);requireValue(b.lifecycle==='active','bot_unavailable');if(!members[id]?.active) members[id]={active:true,generation:(members[id]?.generation ?? 0)+1};}
   for(const d of this.ledger.list('delivery').filter(d=>d.groupId===g.groupId && (!members[d.botId]?.active || members[d.botId].generation!==d.membershipGeneration))) { this.save('delivery',{...d,state:'revoked'}); const o=this.ledger.get('outbox',d.deliveryId); if(o) this.save('outbox',{...o,state:'revoked'}); }
   return this.save('group',{...g,members,revision:g.revision+1});
  },
  sendMessage(p,e,actor) {
   const g=this.object('group',p.groupId,e);
   requireValue(Array.isArray(p.recipients ?? []),'invalid_recipients');
   const ids=canonicalTargets(this,g,p.recipients?.length ? p.recipients:[g.coordinatorBotId]);
   const message={messageId:randomUUID(),groupId:g.groupId,namespace:g.namespace,content:text(p.content,'content'),producer:actor,rootHumanInstructionRef:e.rootHumanInstructionRef,epoch:g.epoch,operationId:e.operationId,state:'received'};
   this.save('message',message);
   const deliveries=ids.map(botId=>{
    const d={deliveryId:randomUUID(),messageId:message.messageId,groupId:g.groupId,botId,membershipGeneration:g.members[botId].generation,operationId:e.operationId,state:'blocked_native',reason:'Native source/scope/dispatch contract unavailable'};
    this.save('delivery',d);this.save('outbox',{outboxId:d.deliveryId,deliveryId:d.deliveryId,groupId:g.groupId,botId,operationId:e.operationId,state:'blocked_native'});return d;
   });return {message,deliveries};
  },
  startMeeting(p,e) {
   const g=this.object('group',p.groupId,e);activeMember(g,g.coordinatorBotId);requireValue(this.object('bot',g.coordinatorBotId).lifecycle==='active','coordinator_unavailable');
   const topic=text(p.topic,'topic',2000);requireValue(Array.isArray(p.materials),'invalid_material');
   for(const m of p.materials) {requireValue(m.namespace===g.namespace,'scope_denied');text(m.text,'material');text(m.version,'materialVersion',200);}
   const ids=Object.keys(g.members).filter(id=>g.members[id].active);requireValue(Number.isSafeInteger(p.maxOpinions) && p.maxOpinions>=ids.length && p.maxOpinions<=100,'invalid_budget');
   const participants=Object.fromEntries(ids.map(id=>[id,{membershipGeneration:g.members[id].generation,obligationId:randomUUID()}]));
   return this.save('meeting',{meetingId:randomUUID(),groupId:g.groupId,namespace:g.namespace,topic,topicDigest:digest(topic),materials:structuredClone(p.materials),materialDigest:digest(p.materials),participants,epoch:1,revision:1,stage:'independent',round:1,opinions:[],budget:{maxOpinions:p.maxOpinions,usedOpinions:0},nativeMeetingVerified:false,mode:'manual-control-record',createdAt:e.createdAt});
  },
  submitOpinion(p,e,actor) {
   const m=this.object('meeting',p.meetingId,e),g=this.object('group',m.groupId),participant=m.participants[p.botId];
   requireValue(m.stage==='independent','stage_conflict');requireValue(participant,'unknown_target');
   const membership=activeMember(g,p.botId);requireValue(membership.generation===participant.membershipGeneration,'membership_revoked');
   requireValue(this.object('bot',p.botId).lifecycle==='active','bot_unavailable');
   requireValue(!m.opinions.some(o=>o.botId===p.botId),'obligation_conflict');requireValue(m.budget.usedOpinions<m.budget.maxOpinions,'blocked_budget');
   const opinion={opinionId:randomUUID(),meetingId:m.meetingId,botId:p.botId,obligationId:participant.obligationId,content:text(p.content,'opinion'),producer:actor,evidence:'manually recorded; no model request',sealed:true,membershipGeneration:membership.generation,meetingEpoch:m.epoch};
   this.save('meeting',{...m,revision:m.revision+1,opinions:[...m.opinions,opinion],budget:{...m.budget,usedOpinions:m.budget.usedOpinions+1}});return opinion;
  },
  revealOpinions(p,e) {
   const m=this.object('meeting',p.meetingId,e),g=this.object('group',m.groupId);
   const revoked=Object.keys(m.participants).filter(id=>!g.members[id]?.active || g.members[id].generation!==m.participants[id].membershipGeneration || this.object('bot',id).lifecycle!=='active');
   const valid=Object.keys(m.participants).filter(id=>!revoked.includes(id));
   requireValue(valid.every(id=>m.opinions.some(o=>o.botId===id)),'waiting_opinions');
   this.save('meeting',{...m,revision:m.revision+1,stage:'discussion',missing:revoked.map(botId=>({botId,reason:'revoked'})),opinions:m.opinions.map(o=>({...o,sealed:revoked.includes(o.botId)}))});
   return this.publicMeeting(m.meetingId);
  },
  submitTask(p,e,actor) {
   const t=this.object('task',p.taskId,e);requireValue(t.stop.state==='none','task_stopped');requireValue(this.object('bot',t.ownerBotId).lifecycle==='active','owner_unavailable');requireValue(p.expectedAuthorityEpoch===this.ledger.get('grant','root').epoch,'authority_conflict');
   requireValue(/^[a-f0-9]{64}$/.test(p.artifactDigest),'invalid_artifact');
   return this.save('task',{...t,revision:t.revision+1,responsibility:'submitted',artifactDigest:p.artifactDigest,submission:{producer:actor,evidence:text(p.evidence,'evidence'),nativeExecutionVerified:false}});
  },
  acceptTask(p,e,actor) {
   const t=this.object('task',p.taskId,e);requireValue(t.stop.state==='none','task_stopped');requireValue(t.responsibility==='submitted','not_submitted');
   requireValue(p.artifactDigest===t.artifactDigest && p.acceptanceVersion===t.acceptanceVersion,'acceptance_conflict');
   requireValue(['passed','failed','inconclusive'].includes(p.outcome),'invalid_acceptance');
   const check={checkId:randomUUID(),taskRevision:t.revision,artifactDigest:p.artifactDigest,acceptanceVersion:p.acceptanceVersion,actor,outcome:p.outcome};
   this.ledger.put('acceptance',check.checkId,check);
   return this.save('task',{...t,revision:t.revision+1,responsibility:p.outcome==='passed'?'verified':'submitted',acceptanceCheck:check});
  }
 };
 host.publicMeeting=function(id) {const m=this.object('meeting',id);return {...m,received:m.opinions.length,opinions:m.stage==='independent'?[]:m.opinions.filter(o=>!o.sealed)};};
}
