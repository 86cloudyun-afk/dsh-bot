/** Private journal/provider composition. No native capability is serialized or exposed as a service. */
import {Context,symbols} from '@deepseek-ai/cordis';
import {isAbsolute,join} from 'node:path';
import {Host} from './host.mjs';
import {canonical,digest,requireValue} from './errors.mjs';
import {loadOwnedGenerationSdk} from './owned-generation-bridge.mjs';
import {freezeInitialSessionMode} from './initial-session-blank.mjs';
import {createGuiGenerationPolicy} from './bot-gui-generation-policy.mjs';

const identity=value=>value?.[symbols.original]??value;
const coordinates=intent=>canonical(['operationId','sessionId','cwd','agentPreset','kind','botId','botEpoch',
  'configVersion','authorityEpoch','taskId','taskEpoch','taskRevision','workBinding','workDepth','parentBinding','plannedBinding'].map(key=>intent?.[key]??null));
const positive=value=>Number.isSafeInteger(value)&&value>0;
const same=(a,b)=>canonical(a??null)===canonical(b??null);
const fullWorkBinding=binding=>binding&&Object.getPrototypeOf(binding)===Object.prototype
  &&['botId','taskId','sessionId','configVersion','operationId','nonce','inputMessageId'].every(key=>typeof binding[key]==='string'&&binding[key].length>0)
  &&['generation','botEpoch','taskEpoch','taskRevision','authorityEpoch'].every(key=>positive(binding[key]))
  &&typeof binding.messageIdentity==='string'&&/^[a-f0-9]{64}$/.test(binding.messageIdentity)
  &&same(binding.slotLease,{taskId:binding.taskId,sessionId:binding.sessionId,generation:binding.generation,operationId:binding.operationId});

export function createGuiGenerationPreparation({ownerCtx,host,homeDirectory,cwd,agentPreset,route,initialization,
  isOwnerCurrent,canModelDispatch}) {
  requireValue(ownerCtx instanceof Context&&host instanceof Host&&host.adapter.context===ownerCtx
    &&[homeDirectory,cwd].every(value=>typeof value==='string'&&isAbsolute(value))
    &&typeof agentPreset==='string'&&agentPreset.length>0&&typeof isOwnerCurrent==='function'
    &&typeof canModelDispatch==='function','gui_native_owner_required');
  requireValue(route?.provider==='deepseek-official'&&typeof route.model==='string'&&route.model.length>0
    &&route.reasoning==='off','gui_native_route_required');
  const nativeRoute=Object.freeze({provider:route.provider,model:route.model,maxTokens:2048,reasoningEffort:'off'});
  const mode=initialization===undefined?undefined:freezeInitialSessionMode(initialization),journals=new Set(),consumed=new Set();
  let closed=false;
  function current(){
    requireValue(!closed&&ownerCtx.fiber.state===2&&ownerCtx.fiber.uid!==null&&host.adapter.context===ownerCtx,'gui_native_owner_stale');
    const live=isOwnerCurrent();if(live&&typeof live.then==='function')Promise.resolve(live).catch(()=>{});
    requireValue(live===true,'gui_native_owner_stale');
  }
  function original(intent,options){
    current();const stored=host.ledger.get('creation',intent?.operationId);
    requireValue(stored&&coordinates(stored)===coordinates(intent)&&intent.cwd===cwd&&intent.agentPreset===agentPreset
      &&['main','work'].includes(options?.role)&&typeof options.create==='boolean'
      &&typeof options.mainSessionId==='string'&&options.mainSessionId.length>0,'gui_native_creation_changed');
    const bot=host.object('bot',intent.botId),grant=host.ledger.get('grant','native-owner'),config=host.ledger.get('config',intent.configVersion);
    requireValue(bot.epoch===intent.botEpoch&&bot.configVersion===intent.configVersion&&bot.lifecycle==='active'
      &&grant?.epoch===intent.authorityEpoch&&host.isCreationOwnerGrant(grant)&&config?.agentPreset===agentPreset,'gui_native_creation_changed');
    const configured=config[options.role==='main'?'contact':'execution'];
    requireValue(configured?.provider===nativeRoute.provider&&configured.model===nativeRoute.model
      &&(configured.reasoning===null||configured.reasoning==='off'),'gui_native_creation_changed');
    if(options.role==='main')requireValue(intent.kind!=='execution'&&options.mainSessionId===intent.sessionId
      &&bot.creationIntentId===intent.operationId&&(bot.contactSessionId===null||bot.contactSessionId===intent.sessionId),'gui_native_creation_changed');
    else{
      const work=host.ledger.get('workTask',canonical([intent.botId,intent.workBinding?.task_id]));
      requireValue(intent.kind==='execution'&&work?.taskId===intent.taskId&&work.sessionId===intent.sessionId
        &&bot.contactSessionId===options.mainSessionId&&work.taskEpoch===intent.taskEpoch&&work.taskRevision===intent.taskRevision,'gui_native_creation_changed');
    }
    requireValue(options.create?['prepared','creating'].includes(stored.state):stored.state==='created','gui_native_creation_changed');
  }
  function originalInput(binding){
    requireValue(fullWorkBinding(binding),'gui_parent_binding_required');
    const generation=host.ledger.get('workGeneration',canonical([binding.botId,binding.taskId,binding.generation]));
    const delivery=host.ledger.get('workDelivery',canonical([binding.botId,binding.taskId,binding.generation]));
    requireValue(generation&&same(generation.binding,binding)&&same(generation.slotLease,binding.slotLease)
      &&delivery?.sessionId===binding.sessionId&&delivery.generation===binding.generation&&delivery.operationId===binding.operationId
      &&delivery.message?.id===binding.inputMessageId&&digest(delivery.message)===binding.messageIdentity,'gui_parent_binding_required');
  }
  function workPlan(intent,options){
    originalInput(options.plannedBinding);
    const work=host.ledger.get('workTask',canonical([intent.botId,intent.workBinding?.task_id])),binding=options.plannedBinding;
    requireValue((intent.plannedBinding===undefined||same(intent.plannedBinding,binding))&&binding.botId===intent.botId&&binding.taskId===intent.taskId
      &&binding.sessionId===intent.sessionId&&binding.generation===work.generation&&binding.botEpoch===intent.botEpoch
      &&binding.taskEpoch===intent.taskEpoch&&binding.taskRevision===intent.taskRevision&&binding.authorityEpoch===intent.authorityEpoch
      &&binding.configVersion===intent.configVersion,'gui_parent_binding_required');
    return work;
  }
  function parentPlan(intent,options){
    requireValue(options.role==='work'&&options.delegateTool?.name==='dsh_bot_delegate','gui_parent_delegate_required');
    const work=workPlan(intent,options);
    requireValue(work.depth===0&&intent.workDepth!==1,'gui_parent_binding_required');
  }
  function childPlan(intent,options,sdk){
    requireValue(options.create===true&&options.delegateTool===undefined
      &&intent.workDepth===1&&same(intent.parentBinding,options.parentBinding),'gui_child_binding_required');
    workPlan(intent,options);
    originalInput(options.parentBinding);
    const work=host.ledger.get('workTask',canonical([intent.botId,intent.workBinding?.task_id])),binding=options.parentBinding;
    const parent=host.ledger.list('workTask').find(row=>row.botId===intent.botId&&row.taskId===binding.taskId&&row.sessionId===binding.sessionId);
    requireValue(work.depth===1&&work.parentTaskId===binding.taskId&&parent?.depth===0&&parent.generation===binding.generation
      &&parent.botEpoch===intent.botEpoch&&parent.configVersion===intent.configVersion&&parent.authorityEpoch===intent.authorityEpoch
      &&sdk.isOwnedGenerationSource(options.parentSource,ownerCtx)===true&&typeof sdk.prepareOwnedChildGenerationSource==='function','gui_child_source_required');
  }
  async function prepare(intent,options,child=false){
      original(intent,options);const consumedKey=canonical([options.role,intent.sessionId]);
      if(!child&&options.role==='work'&&options.delegateTool!==undefined)parentPlan(intent,options);
      else if(!child&&options.role==='work'&&options.plannedBinding!==undefined)workPlan(intent,options);
      requireValue(!consumed.has(consumedKey),'gui_native_preparation_consumed');consumed.add(consumedKey);
      const sdk=await loadOwnedGenerationSdk();original(intent,options);
      if(child)childPlan(intent,options,sdk);
      requireValue(typeof sdk.openOwnedGenerationJournal==='function'&&typeof sdk.isOwnedGenerationJournal==='function','gui_owned_journal_unsupported');
      const directory=ownerCtx.get('deepseekProtectedProviders'),providerFactory=directory?.lookup?.(nativeRoute.provider);
      requireValue(providerFactory,'gui_protected_provider_required');
      const unchanged=()=>{original(intent,options);requireValue(identity(ownerCtx.get('deepseekProtectedProviders'))===identity(directory)
        &&directory.lookup(nativeRoute.provider)===providerFactory,'gui_protected_provider_changed');};
      if(!options.create&&options.role==='main')requireValue(options.delegateTool?.name==='dsh_bot_delegate','gui_resume_delegate_required');
      unchanged();
      const journal=await sdk.openOwnedGenerationJournal({ownerCtx,directory:join(homeDirectory,'owned-generations',digest({botId:intent.botId,sessionId:intent.sessionId,role:options.role})),
        create:options.create,sessionId:intent.sessionId,role:options.role,...options.role==='work'?{toolPolicy:!child&&options.delegateTool?'delegate':'zero'}:{},
        route:nativeRoute,initialization:mode,session:{cwd,agentPreset}});
      try{
        unchanged();requireValue(sdk.isOwnedGenerationJournal(journal,ownerCtx,intent.sessionId,options.role)===true,'gui_owned_journal_required');
        const policy=createGuiGenerationPolicy({ledger:host.ledger,ledgerId:host.ledgerInstanceId,botId:intent.botId,botEpoch:intent.botEpoch,
          configVersion:intent.configVersion,authorityEpoch:intent.authorityEpoch,mainSessionId:options.mainSessionId,sessionId:intent.sessionId,
          role:options.role,isOwnerCurrent:()=>{try{current();return true;}catch{return false;}},canModelDispatch});
        const common={ownerCtx,providerFactory,sessionId:intent.sessionId,route:nativeRoute,initialization:mode,journal,
          isCurrent:policy.isCurrent,canDispatch:policy.canDispatch,
          ...(options.role==='work'&&(!options.delegateTool||child)&&options.plannedBinding?{plannedBinding:options.plannedBinding}:{})};
        if(!child&&options.role==='work'&&options.delegateTool!==undefined)parentPlan(intent,options);
        if(child)childPlan(intent,options,sdk);
        const prepared=child?sdk.prepareOwnedChildGenerationSource(options.parentSource,options.parentGeneration,common)
          :sdk.prepareOwnedGenerationSource({...common,role:options.role,
            ...(options.role==='work'&&options.delegateTool?{workDelegate:{plannedBinding:options.plannedBinding,delegateTool:options.delegateTool}}
              :options.delegateTool?{delegateTool:options.delegateTool}:{})});
        unchanged();requireValue(sdk.isPreparedOwnedGenerationSource(prepared,ownerCtx,intent.sessionId,options.role)===true
          &&prepared.mode===(options.create?'create':'resume'),'gui_owned_preparation_required');
        journals.add(journal);return Object.freeze({prepared,route:nativeRoute});
      }catch(error){await journal.close();throw error;}
  }
  return Object.freeze({
    prepare:(intent,options)=>prepare(intent,options),
    prepareChild:(intent,options)=>prepare(intent,{...options,role:'work'},true),
    async close(){if(closed)return;closed=true;await Promise.allSettled([...journals].map(journal=>journal.close()));journals.clear();},
  });
}
