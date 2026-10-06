/** Private, creation-only entry. Never provide this driver or its caller through Cordis/RPC. */
import { canonical,requireValue } from './errors.mjs';
import { requireHealthyPreset } from './session-mode.mjs';

const inFlight=new Set();
function fence(host,i,isCurrent) {
 try{const live=isCurrent();if(live && typeof live.then==='function')Promise.resolve(live).catch(()=>{});if(live!==true)return 'creation_owner_changed';}catch{return 'creation_owner_changed';}
 if(i.workBinding){const w=host.ledger.get('workTask',canonical([i.botId,i.workBinding.task_id])),g=w&&host.ledger.get('workGeneration',canonical([i.botId,i.taskId,i.workBinding.generation]));if(!w || w.taskId!==i.taskId || w.sessionId!==i.sessionId || w.generation!==i.workBinding.generation || !g || g.fence!==null)return 'work_generation_fenced';}
 const b=host.ledger.get('bot',i.botId),g=host.ledger.get('grant',i.authorizationRef);
 if(i.state==='fenced' || i.stopped)return 'creation_stopped';
 if(!g?.active || g.epoch!==i.authorityEpoch || !host.isCreationOwnerGrant(g))return 'authority_changed';
 if(!b || b.lifecycle!=='active' || b.epoch!==i.botEpoch)return 'bot_changed';
 if(b.configVersion!==i.configVersion || (i.kind!=='execution' && b.creationIntentId!==i.operationId))return 'config_changed';
 if(i.kind==='execution') {const task=host.ledger.get('task',i.taskId);if(!task || task.ownerBotId!==b.botId || task.epoch!==i.taskEpoch || task.revision!==i.taskRevision || task.stop.state!=='none' || task.pendingRevision)return 'task_changed';}
 if(i.deadline!==null && Date.parse(i.deadline)<=Date.now())return 'deadline_expired';
 return null;
}
function current(host,id) {
 const i=host.ledger.get('creation',id);requireValue(i,'not_found');return i;
}
function fenced(host,i,reason) {
 return host.ledger.put('creation',i.operationId,{...i,state:'fenced',errorCategory:reason});
}
function validProof(i,p) {
 return p?.sessionId===i.sessionId && p.agentPreset===i.agentPreset && p.blank===true && p.globalTools===0 && p.scopedTools===0;
}

export class SessionCreationDriver {
 #host;#caller;#port;#isCurrent;
 constructor({host,caller,port,isCurrent=()=>true}) {
  requireValue(caller && typeof caller==='object','unsupported_host_identity');
  requireValue(typeof port?.createOwnedSession==='function' && typeof port?.inspectOwnedCreation==='function','unsupported_native_creation');
  requireValue(typeof isCurrent==='function','invalid_creation_guard');this.#isCurrent=isCurrent;this.#host=host;this.#caller=caller;this.#port=port;
 }
 async run(caller,operationId) {
  requireValue(caller===this.#caller,'unsupported_host_identity');
  const host=this.#host,key=`${host.ledgerInstanceId}/${operationId}`;
  requireValue(!inFlight.has(key),'creation_in_progress');inFlight.add(key);
  try {
   const initial=host.ledger.transaction(()=>{
    const i=current(host,operationId),reason=fence(host,i,this.#isCurrent);
    return reason?fenced(host,i,reason):i;
   });
   if(['fenced','created'].includes(initial.state) || initial.errorCategory==='creation_receipt_mismatch')return initial;
   // Refresh actual healthy IDs outside a DB transaction; no mandatory mode revision.
   requireHealthyPreset(await host.adapter.refreshSessionModeCatalog(),initial.agentPreset);
   const claim=host.ledger.transaction(()=>{
    const i=current(host,operationId),reason=fence(host,i,this.#isCurrent);
    if(reason)return {intent:fenced(host,i,reason),create:false};
    if(i.state==='prepared')return {intent:host.ledger.put('creation',operationId,{...i,state:'creating'}),create:true};
    requireValue(['creating','unknown','created'].includes(i.state),'invalid_creation_state');
    return {intent:i,create:false};
   });
   if(['fenced','created'].includes(claim.intent.state))return claim.intent;
   const i=claim.intent;let receipt=claim.create?'returned':'recovered_same_id',receiptMismatch=false;
   if(claim.create) {
    try {const result=await this.#port.createOwnedSession(Object.freeze({...i}));receiptMismatch=result?.sessionId!==i.sessionId;}
    catch {receipt='recovered_same_id';}
   }
   // A definite different-ID receipt is durable before any further native await.
   if(receiptMismatch)return host.ledger.transaction(()=>{
    const latest=current(host,operationId),reason=fence(host,latest,this.#isCurrent);
    return reason?fenced(host,latest,reason):host.ledger.put('creation',operationId,{...latest,state:'unknown',errorCategory:'creation_receipt_mismatch'});
   });
   const after=host.ledger.transaction(()=>{
    const latest=current(host,operationId),reason=fence(host,latest,this.#isCurrent);
    return reason?fenced(host,latest,reason):latest;
   });
   if(after.state==='fenced')return after;
   // One bounded, read-only lookup of this original ID; never issue another create.
   let proof;try{proof=await this.#port.inspectOwnedCreation(Object.freeze({...i}));}catch{proof=null;}
   return host.ledger.transaction(()=>{
    const latest=current(host,operationId),reason=fence(host,latest,this.#isCurrent);
    if(reason)return fenced(host,latest,reason);
    if(!validProof(i,proof))return host.ledger.put('creation',operationId,{...latest,state:'unknown',errorCategory:proof===null?'creation_outcome_unknown':'creation_proof_mismatch'});
    if(i.kind==='execution')host.ledger.put('nativeSession',i.sessionId,{sessionId:i.sessionId,creationIntentId:i.operationId,botId:i.botId,taskId:i.taskId,kind:'execution',configVersion:i.configVersion,agentPreset:i.agentPreset});
    else {
     const b=host.ledger.get('bot',i.botId),conversation=host.ledger.get('conversation',b.contactConversationId);
     requireValue(conversation?.botId===b.botId && conversation.sessionId===null && b.contactSessionId===null,'contact_binding_conflict');
     host.save('conversation',{...conversation,sessionId:i.sessionId,revision:conversation.revision+1});
     host.save('bot',{...b,contactSessionId:i.sessionId,nativeStatus:'creation_bound',revision:b.revision+1});
    }
    // Copy the verified fields only; never persist raw native diagnostics or metadata.
    return host.ledger.put('creation',operationId,{...latest,state:'created',receipt,proof:{sessionId:i.sessionId,agentPreset:i.agentPreset,blank:true,globalTools:0,scopedTools:0},confirmedAt:new Date().toISOString()});
   });
  } finally {inFlight.delete(key);}
 }
}
