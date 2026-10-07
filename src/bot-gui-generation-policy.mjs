/** Private admission checks. Durable labels never replace a native source or receipt. */
import {canonical,digest,requireValue} from './errors.mjs';

const key=(...parts)=>canonical(parts);
const same=(a,b)=>canonical(a)===canonical(b);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const syncTrue=callback=>{
  const value=callback();
  if(value&&typeof value.then==='function')Promise.resolve(value).catch(()=>{});
  return value===true;
};

export function createGuiGenerationPolicy({ledger,botId,botEpoch,configVersion,authorityEpoch,
  mainSessionId,sessionId,role,ledgerId,isOwnerCurrent,canModelDispatch}) {
  requireValue(ledger&&typeof ledger.get==='function'&&typeof ledger.list==='function'
    &&[botId,configVersion,mainSessionId,sessionId,ledgerId].every(value=>typeof value==='string'&&value.length>0)
    &&positive(botEpoch)&&positive(authorityEpoch)&&['main','work'].includes(role)
    &&typeof isOwnerCurrent==='function'&&typeof canModelDispatch==='function','gui_generation_policy_required');
  const fixed=Object.freeze({botId,botEpoch,configVersion,authorityEpoch,mainSessionId,sessionId,role,ledgerId});
  function owner() {
    requireValue(syncTrue(isOwnerCurrent),'gui_owner_stale');
    const grant=ledger.get('grant','native-owner'),bot=ledger.get('bot',fixed.botId);
    requireValue(grant?.active===true&&grant.epoch===fixed.authorityEpoch&&grant.actor?.kind==='host'
      &&grant.actor.id===fixed.ledgerId&&grant.authority==='private-runtime-owner'&&grant.scope==='owned-text-sessions','gui_authority_changed');
    requireValue(bot?.botId===fixed.botId&&bot.epoch===fixed.botEpoch&&bot.configVersion===fixed.configVersion
      &&bot.contactSessionId===fixed.mainSessionId&&bot.lifecycle==='active','gui_binding_changed');
  }
  function base(binding,targetSession) {
    requireValue(binding&&Object.getPrototypeOf(binding)===Object.prototype
      &&Reflect.ownKeys(binding).length===Object.keys(binding).length,'gui_generation_binding_changed');
    requireValue(binding.botId===fixed.botId&&binding.botEpoch===fixed.botEpoch&&binding.configVersion===fixed.configVersion
      &&binding.authorityEpoch===fixed.authorityEpoch&&binding.sessionId===targetSession
      &&[binding.generation,binding.taskEpoch,binding.taskRevision].every(positive),'gui_generation_binding_changed');
  }
  function work(binding) {
    base(binding,binding.sessionId);
    const rows=ledger.list('workTask').filter(row=>row.botId===fixed.botId&&row.taskId===binding.taskId&&row.sessionId===binding.sessionId);
    requireValue(rows.length===1,'gui_work_binding_changed');
    const row=rows[0],task=ledger.get('task',row.taskId),original=ledger.get('workGeneration',key(fixed.botId,row.taskId,binding.generation));
    requireValue(row.botEpoch===fixed.botEpoch&&row.configVersion===fixed.configVersion&&row.authorityEpoch===fixed.authorityEpoch
      &&row.taskEpoch===binding.taskEpoch&&row.taskRevision===binding.taskRevision
      &&task?.taskId===row.taskId&&task.ownerBotId===fixed.botId&&task.ownerBotEpoch===fixed.botEpoch
      &&task.epoch===binding.taskEpoch&&task.revision===binding.taskRevision&&task.stop?.state==='none'&&!task.pendingRevision,'gui_task_changed');
    const lease={taskId:row.taskId,sessionId:row.sessionId,generation:binding.generation,operationId:binding.operationId};
    requireValue(original?.botId===fixed.botId&&original.taskId===row.taskId&&original.sessionId===row.sessionId
      &&original.generation===binding.generation&&same(original.binding,binding)
      &&same(original.slotLease,lease)&&same(binding.slotLease,lease),'gui_original_work_required');
    const delivery=ledger.get('workDelivery',key(fixed.botId,row.taskId,binding.generation));
    requireValue(delivery?.sessionId===row.sessionId&&delivery.generation===binding.generation&&delivery.operationId===binding.operationId
      &&delivery.message?.id===binding.inputMessageId&&digest(delivery.message)===binding.messageIdentity,'gui_original_input_changed');
    return {row,original};
  }
  function main(binding) {
    base(binding,fixed.mainSessionId);
    const original=ledger.get('ownedMainGeneration',key(fixed.botId,fixed.mainSessionId,binding.generation));
    requireValue(original&&same(original.binding,binding),'gui_original_main_required');
    if(binding.kind==='contact') {
      const contact=ledger.get('contactOwnerOperation',key(fixed.botId,binding.operationId));
      requireValue(binding.taskId===binding.operationId&&binding.taskEpoch===1&&binding.taskRevision===1
        &&contact?.command==='sendContactText'&&contact.operationId===binding.operationId&&contact.nonce===binding.nonce
        &&contact.botId===fixed.botId&&contact.sessionId===fixed.mainSessionId&&contact.botEpoch===fixed.botEpoch
        &&contact.authorityEpoch===fixed.authorityEpoch&&contact.configVersion===fixed.configVersion
        &&same(contact.generationBinding,binding)&&contact.message?.id===binding.inputMessageId
        &&digest(contact.message)===binding.messageIdentity,'gui_original_contact_required');
      return {original,contact,parent:null};
    }
    requireValue(binding.kind==='work-result'&&binding.nonce===binding.operationId,'gui_original_result_required');
    const parent=work(binding.parentWorkBinding),route=ledger.get('workObservedResponse',binding.operationId);
    requireValue(binding.taskId===binding.parentWorkBinding.taskId&&binding.taskEpoch===binding.parentWorkBinding.taskEpoch
      &&binding.taskRevision===binding.parentWorkBinding.taskRevision&&route?.botId===fixed.botId
      &&route.taskId===parent.row.taskId&&route.sessionId===parent.row.sessionId&&route.generation===binding.parentWorkBinding.generation
      &&route.resultInputMessageId===binding.inputMessageId&&same(route.generationBinding,binding),'gui_original_result_required');
    return {original,contact:null,parent};
  }
  function check(binding) {
    owner();base(binding,fixed.sessionId);
    const result=fixed.role==='main'?main(binding):work(binding);
    owner();return result;
  }
  return Object.freeze({
    isCurrent(binding) {try{check(binding);return true;}catch{return false;}},
    canDispatch(binding) {
      try {
        const result=check(binding);
        requireValue(syncTrue(canModelDispatch),'gui_model_requests_disabled');
        if(fixed.role==='main') {
          const counter=ledger.get('ownedMainGenerationCounter',key(fixed.botId,fixed.mainSessionId));
          requireValue(counter?.generation===binding.generation&&result.original.fence===null,'gui_main_generation_fenced');
          requireValue(!result.contact||result.contact.fence===null,'gui_contact_generation_fenced');
          if(result.parent)requireValue(result.parent.row.generation===binding.parentWorkBinding.generation
            &&result.parent.original.fence===null,'gui_work_generation_fenced');
        } else requireValue(result.row.generation===binding.generation&&result.original.fence===null,'gui_work_generation_fenced');
        owner();return true;
      } catch{return false;}
    },
  });
}
