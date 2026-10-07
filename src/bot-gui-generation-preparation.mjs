/** Private journal/provider composition. No native capability is serialized or exposed as a service. */
import {Context,symbols} from '@deepseek-ai/cordis';
import {isAbsolute,join} from 'node:path';
import {Host} from './host.mjs';
import {canonical,digest,requireValue} from './errors.mjs';
import {loadOwnedGenerationSdk} from './owned-generation-bridge.mjs';
import {freezeInitialSessionMode} from './initial-session-blank.mjs';
import {createGuiGenerationPolicy} from './bot-gui-generation-policy.mjs';
import {isOwnedBotLifecycleRestoreGrant,describeOwnedBotLifecycleRestore} from './owned-bot-lifecycle.mjs';

const identity=value=>value?.[symbols.original]??value;
const coordinates=intent=>canonical(['operationId','nonce','sessionId','cwd','agentPreset','kind','botId','botEpoch',
  'configVersion','authorityEpoch','taskId','taskEpoch','taskRevision','workBinding','workDepth','parentBinding','plannedBinding'].map(key=>intent?.[key]??null));
const positive=value=>Number.isSafeInteger(value)&&value>0;
const same=(a,b)=>canonical(a??null)===canonical(b??null);
const freezeJSON=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freezeJSON(child);Object.freeze(value);}return value;};
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
  const mode=initialization===undefined?undefined:freezeInitialSessionMode(initialization),journals=new Set(),consumed=new Set(),entries=new Map();
  let closed=false,archiveGate=null;
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
  function originalCreation(intent,options){
    requireValue(typeof intent.nonce==='string'&&intent.nonce.length>0&&intent.nonce.length<=200,'gui_original_creation_required');
    const key=canonical([intent.botId,intent.sessionId,options.role]),retained=host.ledger.get('guiNativeCreationOriginal',key);
    if(options.create){
      const snapshot=freezeJSON(JSON.parse(canonical({binding:intent,operationId:intent.operationId,nonce:intent.nonce})));
      requireValue(!retained||same(retained,snapshot),'gui_original_creation_changed');
      if(!retained)host.ledger.put('guiNativeCreationOriginal',key,snapshot);
      return snapshot;
    }
    // Persisted JSON is only the exact policy selector; the SDK independently verifies sealed native history.
    requireValue(retained&&Object.keys(retained).length===3&&retained.operationId===intent.operationId&&retained.nonce===intent.nonce
      &&coordinates(retained.binding)===coordinates(intent)&&['prepared','creating'].includes(retained.binding.state),'gui_original_creation_required');
    return freezeJSON(JSON.parse(canonical(retained)));
  }
  function historyScope(intent,options){
    current();const stored=host.ledger.get('creation',intent?.operationId),bot=host.object('bot',intent?.botId),grant=host.ledger.get('grant','native-owner');
    requireValue(stored?.state==='created'&&coordinates(stored)===coordinates(intent)&&intent.cwd===cwd&&intent.agentPreset===agentPreset
      &&['main','work'].includes(options?.role)&&bot.configVersion===intent.configVersion&&grant?.epoch===intent.authorityEpoch
      &&host.isCreationOwnerGrant(grant),'gui_original_history_required');
    const config=host.ledger.get('config',intent.configVersion),configured=config?.[options.role==='main'?'contact':'execution'];
    requireValue(config?.agentPreset===agentPreset&&configured?.provider===nativeRoute.provider&&configured.model===nativeRoute.model
      &&(configured.reasoning===null||configured.reasoning==='off'),'gui_original_history_required');
    if(options.role==='main')requireValue(intent.kind!=='execution'&&bot.creationIntentId===intent.operationId&&bot.contactSessionId===intent.sessionId,'gui_original_history_required');
    else requireValue(intent.kind==='execution'&&host.ledger.list('workTask').some(work=>work.botId===intent.botId&&work.taskId===intent.taskId
      &&work.sessionId===intent.sessionId),'gui_original_history_required');
    const creationIntent=originalCreation(intent,{role:options.role,create:false});
    requireValue(same(creationIntent,options.originalCreationIntent),'gui_original_creation_changed');
    return creationIntent;
  }
  function exactHistoryBinding(intent,role,binding){
    requireValue(binding?.botId===intent.botId&&binding.sessionId===intent.sessionId&&binding.configVersion===intent.configVersion
      &&binding.authorityEpoch===intent.authorityEpoch&&positive(binding.generation),'gui_original_history_required');
    const row=host.ledger.get(role==='main'?'ownedMainGeneration':'workGeneration',canonical(role==='main'
      ?[binding.botId,binding.sessionId,binding.generation]:[binding.botId,binding.taskId,binding.generation]));
    requireValue(row&&same(row.binding,binding),'gui_original_history_required');
    if(role==='work')originalInput(binding);
  }
  async function mountArchiveGate(sdk,check){
    if(typeof sdk.mountOwnedGenerationArchiveGate!=='function')return;
    archiveGate??=sdk.mountOwnedGenerationArchiveGate(ownerCtx);
    await archiveGate;check();
  }
  async function openHistory(intent,options){
    const creationIntent=historyScope(intent,options),key=canonical([options.role,intent.sessionId]);
    const sdk=await loadOwnedGenerationSdk();historyScope(intent,options);
    requireValue(['selectOwnedGenerationHistory','isOwnedGenerationHistorySelector','mountOwnedGenerationArchiveGate'].every(name=>typeof sdk[name]==='function'),'gui_owned_history_unsupported');
    const existing=entries.get(key);
    if(existing){requireValue(same(existing.creationIntent,creationIntent)&&existing.history===true,'gui_original_history_busy');return existing;}
    await mountArchiveGate(sdk,()=>historyScope(intent,options));
    const journal=await sdk.openOwnedGenerationJournal({ownerCtx,directory:join(homeDirectory,'owned-generations',digest({botId:intent.botId,sessionId:intent.sessionId,role:options.role})),
      create:false,sessionId:intent.sessionId,role:options.role,...options.role==='work'?{toolPolicy:intent.workDepth===0&&intent.plannedBinding?'delegate':'zero'}:{},
      route:nativeRoute,initialization:mode,session:{cwd,agentPreset},creationIntent});
    try{
      historyScope(intent,options);requireValue(sdk.isOwnedGenerationJournal(journal,ownerCtx,intent.sessionId,options.role)===true,'gui_owned_journal_required');
      const authorize=binding=>{historyScope(intent,options);exactHistoryBinding(intent,options.role,binding);return true;};
      const selectHistory=async binding=>{
        authorize(binding);
        const selector=await sdk.selectOwnedGenerationHistory(journal,ownerCtx,binding,Object.freeze({isAuthorized:()=>authorize(binding),
          isDispatchFenced:()=>{try{authorize(binding);return host.object('bot',intent.botId).lifecycle==='archived'||ownerCtx.agents.get(intent.sessionId)===undefined;}catch{return false;}}}));
        authorize(binding);requireValue(sdk.isOwnedGenerationHistorySelector(selector,journal,ownerCtx,binding)===true,'gui_owned_history_required');return selector;
      };
      const entry=Object.freeze({journal,sdk,intent:creationIntent.binding,role:options.role,creationIntent,history:true,selectHistory});
      journals.add(journal);entries.set(key,entry);return entry;
    }catch(error){await journal.close();throw error;}
  }
  async function inspectOriginalHistory(intent,options){
    current();const purpose=options?.purpose;
    requireValue(['archive-restore','active-recovery'].includes(purpose),'gui_original_history_required');
    const bot=host.object('bot',intent?.botId);
    requireValue(bot.lifecycle===(purpose==='archive-restore'?'archived':'active'),purpose==='archive-restore'?'gui_archived_history_required':'gui_active_history_required');
    historyScope(intent,options);
    const {openOwnedWorkspaceSessionPort}=await import('@deepseek-ai/dsh-workspace');current();
    const workspace=openOwnedWorkspaceSessionPort(ownerCtx.workspaceRegistry,ownerCtx);
    requireValue(workspace.isArchived(intent.sessionId)===(purpose==='archive-restore'),'gui_native_history_state_changed');
    requireValue(ownerCtx.agents.get(intent.sessionId)===undefined,'gui_unprotected_main_active');
    const entry=await openHistory(intent,options);current();
    requireValue(workspace.isArchived(intent.sessionId)===(purpose==='archive-restore'),'gui_native_history_state_changed');
    return Object.freeze({journal:entry.journal,selectHistory:entry.selectHistory});
  }
  function restoreDescription(intent,options){
    requireValue(isOwnedBotLifecycleRestoreGrant(options?.grant,host,ownerCtx.fiber,intent)===true,'gui_restore_grant_required');
    current();const description=describeOwnedBotLifecycleRestore(options.grant,host,ownerCtx.fiber,intent);
    requireValue(description.botId===intent.botId&&description.configVersion===intent.configVersion&&description.sessionId===intent.sessionId
      &&description.mainSessionId===options.mainSessionId&&description.authorityEpoch===intent.authorityEpoch
      &&same(description.originalCreationIntent,options.originalCreationIntent),'gui_restore_grant_changed');
    historyScope(intent,options);return description;
  }
  async function prepareRestore(intent,options){
    const description=restoreDescription(intent,options),key=canonical([options.role,intent.sessionId]);
    requireValue(!consumed.has(key),'gui_native_preparation_consumed');
    const entry=await openHistory(intent,options);restoreDescription(intent,options);
    if(options.historyProof){
      requireValue(options.historyProof.journal===entry.journal&&Array.isArray(options.historyProof.selectors)
        &&options.historyProof.selectors.every(row=>entry.sdk.isOwnedGenerationHistorySelector(row.selector,entry.journal,ownerCtx,row.binding)===true),'gui_owned_history_required');
    }
    const sdk=entry.sdk,directory=ownerCtx.get('deepseekProtectedProviders'),providerFactory=directory?.lookup?.(nativeRoute.provider);
    requireValue(providerFactory,'gui_protected_provider_required');
    const unchanged=()=>{restoreDescription(intent,options);requireValue(identity(ownerCtx.get('deepseekProtectedProviders'))===identity(directory)
      &&directory.lookup(nativeRoute.provider)===providerFactory,'gui_protected_provider_changed');};
    const policy=createGuiGenerationPolicy({ledger:host.ledger,ledgerId:host.ledgerInstanceId,botId:description.botId,botEpoch:description.botEpoch,
      configVersion:description.configVersion,authorityEpoch:description.authorityEpoch,mainSessionId:description.mainSessionId,sessionId:intent.sessionId,
      role:options.role,isOwnerCurrent:()=>{try{current();return true;}catch{return false;}},canModelDispatch});
    const common={ownerCtx,providerFactory,sessionId:intent.sessionId,route:nativeRoute,initialization:mode,journal:entry.journal,
      isCurrent:policy.isCurrent,canDispatch:policy.canDispatch};
    let prepared;
    if(options.role==='main'){
      requireValue(options.delegateTool?.name==='dsh_bot_delegate','gui_resume_delegate_required');
      prepared=sdk.prepareOwnedGenerationSource({...common,role:'main',delegateTool:options.delegateTool});
    }else{
      exactHistoryBinding(intent,'work',options.plannedBinding);
      const historicalPlan=options.historyProof?.selectors.find(row=>same(row.binding,options.plannedBinding))?.selector
        ??await entry.selectHistory(options.plannedBinding);unchanged();
      requireValue(sdk.isOwnedGenerationHistorySelector(historicalPlan,entry.journal,ownerCtx,options.plannedBinding)===true,'gui_owned_history_required');
      if(intent.workDepth===1){
        requireValue(options.delegateTool===undefined&&sdk.isOwnedGenerationSource(options.parentSource,ownerCtx)===true
          &&typeof sdk.prepareOwnedKnownChildGenerationSource==='function','gui_child_source_required');
        prepared=await sdk.prepareOwnedKnownChildGenerationSource(options.parentSource,options.parentGeneration,{...common,plannedBinding:options.plannedBinding,historicalPlan});
      }else{
        requireValue(intent.workDepth===0&&options.delegateTool?.name==='dsh_bot_delegate','gui_parent_delegate_required');
        prepared=sdk.prepareOwnedGenerationSource({...common,role:'work',workDelegate:{plannedBinding:options.plannedBinding,delegateTool:options.delegateTool},historicalPlan});
      }
    }
    unchanged();requireValue(sdk.isPreparedOwnedGenerationSource(prepared,ownerCtx,intent.sessionId,options.role)===true&&prepared.mode==='resume','gui_owned_preparation_required');
    consumed.add(key);return Object.freeze({prepared,route:nativeRoute,creationIntent:entry.creationIntent,selectHistory:entry.selectHistory});
  }
  async function releaseArchivedJournals(grant){
    const originals=entries.size?[...entries.values()].map(entry=>entry.intent):host.ledger.list('guiNativeCreationOriginal').map(row=>row.binding);
    requireValue(originals.length>0&&originals.every(intent=>isOwnedBotLifecycleRestoreGrant(grant,host,ownerCtx.fiber,intent)===true),'gui_restore_grant_required');
    current();
    for(const [key,entry]of entries){
      requireValue(isOwnedBotLifecycleRestoreGrant(grant,host,ownerCtx.fiber,entry.intent)===true,'gui_restore_grant_required');
      await entry.journal.close();current();journals.delete(entry.journal);entries.delete(key);consumed.delete(key);
    }
  }
  async function prepare(intent,options,child=false){
      original(intent,options);const consumedKey=canonical([options.role,intent.sessionId]);
      if(!child&&options.role==='work'&&options.delegateTool!==undefined)parentPlan(intent,options);
      else if(!child&&options.role==='work'&&options.plannedBinding!==undefined)workPlan(intent,options);
      requireValue(!consumed.has(consumedKey),'gui_native_preparation_consumed');consumed.add(consumedKey);
      const sdk=await loadOwnedGenerationSdk();original(intent,options);
      if(child)childPlan(intent,options,sdk);
      requireValue(typeof sdk.openOwnedGenerationJournal==='function'&&typeof sdk.isOwnedGenerationJournal==='function','gui_owned_journal_unsupported');
      await mountArchiveGate(sdk,()=>original(intent,options));
      const directory=ownerCtx.get('deepseekProtectedProviders'),providerFactory=directory?.lookup?.(nativeRoute.provider);
      requireValue(providerFactory,'gui_protected_provider_required');
      const unchanged=()=>{original(intent,options);requireValue(identity(ownerCtx.get('deepseekProtectedProviders'))===identity(directory)
        &&directory.lookup(nativeRoute.provider)===providerFactory,'gui_protected_provider_changed');};
      if(!options.create&&options.role==='main')requireValue(options.delegateTool?.name==='dsh_bot_delegate','gui_resume_delegate_required');
      unchanged();
      const creationIntent=originalCreation(intent,options);
      const journal=await sdk.openOwnedGenerationJournal({ownerCtx,directory:join(homeDirectory,'owned-generations',digest({botId:intent.botId,sessionId:intent.sessionId,role:options.role})),
        create:options.create,sessionId:intent.sessionId,role:options.role,...options.role==='work'?{toolPolicy:!child&&options.delegateTool?'delegate':'zero'}:{},
        route:nativeRoute,initialization:mode,session:{cwd,agentPreset},creationIntent});
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
        journals.add(journal);entries.set(consumedKey,Object.freeze({journal,sdk,intent:creationIntent.binding,role:options.role,creationIntent,history:false}));
        return Object.freeze({prepared,route:nativeRoute,creationIntent});
      }catch(error){await journal.close();throw error;}
  }
  return Object.freeze({
    prepare:(intent,options)=>prepare(intent,options),
    prepareChild:(intent,options)=>prepare(intent,{...options,role:'work'},true),
    prepareRestore,
    readOriginalCreation(intent){
      current();const role=intent?.kind==='execution'?'work':'main',originalCreationIntent=originalCreation(intent,{role,create:false});
      historyScope(intent,{role,originalCreationIntent});return originalCreationIntent;
    },
    inspectOriginalHistory,
    inspectArchivedHistory:(intent,options)=>inspectOriginalHistory(intent,{...options,purpose:'archive-restore'}),
    releaseArchivedJournals,
    async close(){if(closed)return;closed=true;await Promise.allSettled([...journals].map(journal=>journal.close()));journals.clear();entries.clear();},
  });
}
